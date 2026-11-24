import AVFoundation
import UIKit

enum CameraResult {
  case photo([String: Any])
  case page
  case cancelled
  case failed(String)
}

/// Board S12, card S4: a plain camera for a board or a demonstration. Pinch, or tap .5, 1 or 2x, to zoom. Page closes it
/// so the page scanner can open. It has no audio input and leaves the audio session alone, so a recording keeps going.
final class PhotoCameraController: UIViewController, AVCapturePhotoCaptureDelegate {
  private let sessionId: String
  private let done: (CameraResult) -> Void
  private let session = AVCaptureSession()
  private let output = AVCapturePhotoOutput()
  private let queue = DispatchQueue(label: "waypoint.photo-camera")
  private let preview = AVCaptureVideoPreviewLayer()
  private let cancel = UIButton(type: .system)
  private let mode = UISegmentedControl(items: ["Photo", "Page"])
  private let shutter = UIButton(type: .custom)
  private var device: AVCaptureDevice?
  private var rotation: AVCaptureDevice.RotationCoordinator?
  private var scale = ZoomScale(wideFactor: 1, minFactor: 1, maxFactor: 1)
  private var pinchStart: CGFloat = 1
  private var zoomButtons: [(preset: Double, button: UIButton)] = []
  private var observers: [NSObjectProtocol] = []
  private var shutterAt: Double = 0
  private var finished = false

  /// True once the camera has settled its result (it may still be on screen until it is dismissed).
  var isFinished: Bool { finished }

  init(sessionId: String, done: @escaping (CameraResult) -> Void) {
    self.sessionId = sessionId
    self.done = done
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    preview.session = session
    preview.videoGravity = .resizeAspect
    view.layer.addSublayer(preview)
    guard configure() else {
      // Reported on the next turn of the main queue, so the camera is dismissed the same way as the other results.
      DispatchQueue.main.async { [weak self] in self?.finish(.failed("The camera could not start")) }
      return
    }
    observeSession()
    view.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
    buildControls()
    setZoom(scale.factor(shown: 1))
    queue.async { [session] in session.startRunning() }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview.frame = view.bounds
  }

  private func configure() -> Bool {
    guard
      let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
      let input = try? AVCaptureDeviceInput(device: device)
    else { return false }
    self.device = device
    let wide = device.virtualDeviceSwitchOverVideoZoomFactors.first.map { $0.doubleValue } ?? 1
    scale = ZoomScale(
      wideFactor: wide, minFactor: Double(device.minAvailableVideoZoomFactor), maxFactor: Double(device.maxAvailableVideoZoomFactor))
    session.automaticallyConfiguresApplicationAudioSession = false
    session.usesApplicationAudioSession = false
    session.beginConfiguration()
    session.sessionPreset = .photo
    guard session.canAddInput(input), session.canAddOutput(output) else {
      session.commitConfiguration()
      return false
    }
    session.addInput(input)
    session.addOutput(output)
    session.commitConfiguration()
    rotation = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: preview)
    return true
  }

  /// An interruption (a call, another app taking the camera) or a runtime error ends the photo camera with a failure.
  private func observeSession() {
    let center = NotificationCenter.default
    let stopped: (Notification) -> Void = { [weak self] _ in
      MainActor.assumeIsolated { self?.finish(.failed("The camera stopped. Try again.")) }
    }
    observers = [
      center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main, using: stopped),
      center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main, using: stopped),
    ]
  }

  private func buildControls() {
    cancel.setTitle("Cancel", for: .normal)
    cancel.setTitleColor(.white, for: .normal)
    cancel.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    cancel.titleLabel?.adjustsFontForContentSizeCategory = true
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

    let zoomRow = UIStackView()
    zoomRow.axis = .horizontal
    zoomRow.spacing = 12
    zoomButtons = scale.presets.map { preset in
      let button = UIButton(type: .custom)
      button.backgroundColor = UIColor(white: 0, alpha: 0.5)
      button.layer.cornerRadius = 22
      button.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.addAction(UIAction { [weak self] _ in
        guard let self else { return }
        self.setZoom(self.scale.factor(shown: preset))
      }, for: .touchUpInside)
      button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      button.heightAnchor.constraint(equalToConstant: 44).isActive = true
      zoomRow.addArrangedSubview(button)
      return (preset, button)
    }

    let hint = UILabel()
    hint.text = "Pinch to zoom"
    hint.textColor = UIColor(white: 1, alpha: 0.8)
    hint.font = .preferredFont(forTextStyle: .footnote)
    hint.adjustsFontForContentSizeCategory = true

    mode.selectedSegmentIndex = 0
    mode.accessibilityLabel = "Photo or page"
    mode.addTarget(self, action: #selector(modeChanged(_:)), for: .valueChanged)
    mode.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

    shutter.backgroundColor = .white
    shutter.layer.cornerRadius = 36
    shutter.layer.borderWidth = 4
    shutter.layer.borderColor = UIColor(white: 0.75, alpha: 1).cgColor
    shutter.accessibilityLabel = "Take photo"
    shutter.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
    shutter.widthAnchor.constraint(equalToConstant: 72).isActive = true
    shutter.heightAnchor.constraint(equalToConstant: 72).isActive = true

    let bottom = UIStackView(arrangedSubviews: [zoomRow, hint, mode, shutter])
    bottom.axis = .vertical
    bottom.alignment = .center
    bottom.spacing = 16
    for item in [cancel, bottom] as [UIView] {
      item.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(item)
    }
    let safe = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      cancel.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
      cancel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20),
      cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      bottom.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
      bottom.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -16),
    ])
  }

  private func setZoom(_ factor: Double) {
    guard let device else { return }
    let target = scale.clamp(factor)
    do {
      try device.lockForConfiguration()
      device.videoZoomFactor = CGFloat(target)
      device.unlockForConfiguration()
    } catch {
      return
    }
    let shown = scale.shown(target)
    for (preset, button) in zoomButtons {
      let active = preset == scale.active(shown: shown)
      button.setTitle(scale.label(preset, shown: shown), for: .normal)
      button.setTitleColor(active ? .systemYellow : .white, for: .normal)
      button.accessibilityTraits = active ? [.button, .selected] : .button
      button.accessibilityLabel = "Zoom \(ZoomScale.number(preset)) times" + (active ? ", selected" : "")
    }
  }

  @objc private func pinched(_ pinch: UIPinchGestureRecognizer) {
    guard let device else { return }
    if pinch.state == .began { pinchStart = device.videoZoomFactor }
    if pinch.state == .changed { setZoom(Double(pinchStart * pinch.scale)) }
  }

  @objc private func modeChanged(_ control: UISegmentedControl) {
    if control.selectedSegmentIndex == 1 { finish(.page) }
  }

  @objc private func cancelTapped() { finish(.cancelled) }

  @objc private func shutterTapped() {
    guard !finished else { return }
    // Nothing can close the camera while the photo is taken, except its result.
    shutter.isEnabled = false
    cancel.isEnabled = false
    mode.isEnabled = false
    shutterAt = (Date().timeIntervalSince1970 * 1000).rounded()
    if let angle = rotation?.videoRotationAngleForHorizonLevelCapture, let connection = output.connection(with: .video),
      connection.isVideoRotationAngleSupported(angle)
    {
      connection.videoRotationAngle = angle
    }
    output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
  }

  nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let data = error == nil ? photo.fileDataRepresentation() : nil
    DispatchQueue.main.async { [weak self] in self?.save(data) }
  }

  private func save(_ data: Data?) {
    guard !finished else { return }
    guard let data, let image = UIImage(data: data) else {
      finish(.failed("The photo could not be taken"))
      return
    }
    let sessionId = self.sessionId
    let capturedAt = shutterAt
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      // Checked again on the main queue before anything is written: the camera may have closed while this waited.
      let open = DispatchQueue.main.sync { !(self?.finished ?? true) }
      guard open else { return }
      let result: CameraResult
      do {
        var page = try PageStore.save(image, sessionId: sessionId)
        page["capturedAt"] = capturedAt
        result = .photo(page)
      } catch {
        result = .failed(error.localizedDescription)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, !self.finished else {
          // Closed after the file was written: nothing will show it, so the file goes.
          if case .photo(let page) = result, let file = page["file"] as? String {
            try? FileManager.default.removeItem(at: PageStore.documents.appendingPathComponent(file))
          }
          return
        }
        self.finish(result)
      }
    }
  }

  /// Closes the camera, then answers, so the page scanner can be shown right after it. While the camera is still being
  /// presented it cannot be dismissed yet: the answer goes out now and the presenter dismisses it once it is shown.
  private func finish(_ result: CameraResult) {
    guard !finished else { return }
    finished = true
    queue.async { [session] in session.stopRunning() }
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    let done = self.done
    guard presentingViewController != nil, !isBeingPresented else {
      done(result)
      return
    }
    dismiss(animated: true) { done(result) }
  }
}
