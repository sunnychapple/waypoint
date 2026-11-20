import AVFoundation
import Foundation
import UIKit

// Every way a video render can be refused. JavaScript sees the code (see WaypointVideoModule).
enum VideoError: Error {
  case badInput, noAudio, writeFailed, busy

  var code: String {
    switch self {
    case .badInput: return "bad_input"
    case .noAudio: return "no_audio"
    case .writeFailed: return "write_failed"
    case .busy: return "busy"
    }
  }
}

struct SlideContent {
  let heading: String
  let bullets: [String]
}

// Draws the slides and writes them with the narration into one H.264 .mp4 (docs/architecture.md section 2). Thin: the
// timing is in SlideTimeline (Core, tested on the Mac). One frame per slide, at the slide's start; the narration's audio
// track is copied in without re-encoding. Renders while the app is in the foreground.
final class SlideVideoWriter {
  static let width = 1280
  static let height = 720
  private static let margin: CGFloat = 80
  private static let videoSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: SlideVideoWriter.width,
    AVVideoHeightKey: SlideVideoWriter.height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_500_000],
  ]

  private let stateLock = NSLock()
  private var rendering = false // stateLock

  // One frame to append: the slide on screen from startMs, and the title if this is the first slide.
  private struct Frame {
    let startMs: Int
    let slide: SlideContent
    let title: String?
  }

  // Returns the video's length in milliseconds. Writes to a temporary file and moves it to outURL when it is complete.
  func render(title: String, slides: [SlideContent], slideStartsMs: [Int], audioURL: URL, outURL: URL) async throws -> Int {
    guard !slides.isEmpty, slides.count == slideStartsMs.count else { throw VideoError.badInput }
    try claim()
    defer { release() }

    guard FileManager.default.fileExists(atPath: audioURL.path) else { throw VideoError.noAudio }
    let asset = AVURLAsset(url: audioURL)
    let seconds = CMTimeGetSeconds(try await asset.load(.duration))
    guard seconds.isFinite, seconds > 0 else { throw VideoError.noAudio }
    let totalMs = Int((seconds * 1000).rounded())
    guard let audioTrack = try await asset.loadTracks(withMediaType: .audio).first else { throw VideoError.noAudio }

    let spans = SlideTimeline.spans(slideStartsMs: slideStartsMs, totalMs: totalMs)
    guard !spans.isEmpty else { throw VideoError.badInput }
    var frames = spans.map { Frame(startMs: $0.startMs, slide: slides[$0.index], title: $0.index == 0 ? title : nil) }
    // The last slide again at the very end, so it shows until the audio ends.
    if let last = frames.last, totalMs - 1 > last.startMs {
      frames.append(Frame(startMs: totalMs - 1, slide: last.slide, title: last.title))
    }

    let folder = outURL.deletingLastPathComponent()
    let partURL = folder.appendingPathComponent("\(outURL.deletingPathExtension().lastPathComponent).partial.mp4")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try await write(frames: frames, audioAsset: asset, audioTrack: audioTrack, to: partURL)
      if FileManager.default.fileExists(atPath: outURL.path) { try FileManager.default.removeItem(at: outURL) }
      try FileManager.default.moveItem(at: partURL, to: outURL)
    } catch {
      try? FileManager.default.removeItem(at: partURL) // a failed or refused render leaves no file behind
      throw error
    }
    return totalMs
  }

  // Appends the frames and the audio samples, alternately, as each input is ready. Both inputs are fed in one loop so
  // that neither waits on the other.
  private func write(frames: [Frame], audioAsset: AVURLAsset, audioTrack: AVAssetTrack, to url: URL) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: Self.videoSettings)
    videoInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: Self.width,
      kCVPixelBufferHeightKey as String: Self.height,
    ])
    let formats: [CMFormatDescription] = try await audioTrack.load(.formatDescriptions)
    let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: formats.first)
    audioInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoInput), writer.canAdd(audioInput) else { throw VideoError.writeFailed }
    writer.add(videoInput)
    writer.add(audioInput)

    let reader = try AVAssetReader(asset: audioAsset)
    let audioOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
    guard reader.canAdd(audioOutput) else { throw VideoError.writeFailed }
    reader.add(audioOutput)
    guard writer.startWriting() else { throw VideoError.writeFailed }
    reader.startReading()
    guard reader.status == .reading else { writer.cancelWriting(); throw VideoError.writeFailed }
    writer.startSession(atSourceTime: .zero)

    var nextFrame = 0
    var videoDone = false
    var audioDone = false
    var pendingAudio: CMSampleBuffer?
    while !videoDone || !audioDone {
      var progressed = false
      if !videoDone, videoInput.isReadyForMoreMediaData {
        if nextFrame < frames.count {
          let frame = frames[nextFrame]
          let buffer = try makeFrame(frame, adaptor: adaptor)
          guard adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame.startMs), timescale: 1000)) else {
            writer.cancelWriting()
            throw VideoError.writeFailed
          }
          nextFrame += 1
        } else {
          videoInput.markAsFinished()
          videoDone = true
        }
        progressed = true
      }
      if !audioDone {
        if pendingAudio == nil {
          pendingAudio = audioOutput.copyNextSampleBuffer()
          if pendingAudio == nil {
            audioInput.markAsFinished()
            audioDone = true
            progressed = true
          }
        }
        if let sample = pendingAudio, audioInput.isReadyForMoreMediaData {
          guard audioInput.append(sample) else {
            writer.cancelWriting()
            throw VideoError.writeFailed
          }
          pendingAudio = nil
          progressed = true
        }
      }
      if !progressed { try await Task.sleep(nanoseconds: 5_000_000) }
    }
    guard reader.status == .completed else { writer.cancelWriting(); throw VideoError.writeFailed }

    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw VideoError.writeFailed }
  }

  // One frame drawn into a buffer from the adaptor's pool.
  private func makeFrame(_ frame: Frame, adaptor: AVAssetWriterInputPixelBufferAdaptor) throws -> CVPixelBuffer {
    guard let pool = adaptor.pixelBufferPool else { throw VideoError.writeFailed }
    var pixelBuffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess, let buffer = pixelBuffer else {
      throw VideoError.writeFailed
    }
    guard let image = Self.image(for: frame).cgImage else { throw VideoError.writeFailed }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
      data: CVPixelBufferGetBaseAddress(buffer),
      width: Self.width,
      height: Self.height,
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.noneSkipFirst.rawValue
    ) else { throw VideoError.writeFailed }
    context.draw(image, in: CGRect(x: 0, y: 0, width: Self.width, height: Self.height))
    return buffer
  }

  // The slide as UIKit text on the light theme's background (src/ui/theme.ts, light). Text is shrunk until it fits.
  private static func image(for frame: Frame) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let size = CGSize(width: width, height: height)
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      color(0xF7F3EB).setFill()
      UIRectFill(CGRect(origin: .zero, size: size))
      let contentWidth = size.width - 2 * margin
      let scale = fittingScale(frame, width: contentWidth, maxHeight: size.height - 2 * margin)
      var y = margin
      for text in texts(frame, scale: scale) {
        let h = textHeight(text, width: contentWidth)
        text.draw(with: CGRect(x: margin, y: y, width: contentWidth, height: h), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        y += h
      }
    }
  }

  // The largest scale from 1 down to 0.4 (in steps of 0.05) at which the slide's text fits; 0.4 if none does.
  private static func fittingScale(_ frame: Frame, width: CGFloat, maxHeight: CGFloat) -> CGFloat {
    var scale: CGFloat = 1
    while scale > 0.4 {
      let total = texts(frame, scale: scale).reduce(CGFloat(0)) { $0 + textHeight($1, width: width) }
      if total <= maxHeight { return scale }
      scale -= 0.05
    }
    return 0.4
  }

  // Title (first slide only), heading, then one paragraph per bullet with "•".
  private static func texts(_ frame: Frame, scale: CGFloat) -> [NSAttributedString] {
    var result: [NSAttributedString] = []
    if let title = frame.title {
      result.append(styled(title, size: 40 * scale, weight: .semibold, color: color(0x3B34D6), spacing: 24 * scale, bullet: false, scale: scale))
    }
    result.append(styled(frame.slide.heading, size: 56 * scale, weight: .semibold, color: color(0x1B1915), spacing: 36 * scale, bullet: false, scale: scale))
    for bullet in frame.slide.bullets {
      result.append(styled("• " + bullet, size: 34 * scale, weight: .regular, color: color(0x4D4940), spacing: 16 * scale, bullet: true, scale: scale))
    }
    return result
  }

  private static func styled(_ string: String, size: CGFloat, weight: UIFont.Weight, color: UIColor, spacing: CGFloat, bullet: Bool, scale: CGFloat) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.paragraphSpacing = spacing
    if bullet { paragraph.headIndent = 36 * scale }
    return NSAttributedString(string: string, attributes: [
      .font: UIFont.systemFont(ofSize: size, weight: weight),
      .foregroundColor: color,
      .paragraphStyle: paragraph,
    ])
  }

  private static func textHeight(_ text: NSAttributedString, width: CGFloat) -> CGFloat {
    let rect = text.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    return ceil(rect.height)
  }

  private static func color(_ hex: Int) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }

  private func claim() throws {
    try stateLock.withLock {
      guard !rendering else { throw VideoError.busy }
      rendering = true
    }
  }

  private func release() {
    stateLock.withLock { rendering = false }
  }
}
