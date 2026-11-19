import ExpoModulesCore
import UIKit

enum PageStore {
  static let documents: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

  /// Returns a path relative to Documents, and creates the session folder.
  static func newPagePath(sessionId: String) -> String {
    try? FileManager.default.createDirectory(
      at: documents.appendingPathComponent("sessions/\(sessionId)", isDirectory: true),
      withIntermediateDirectories: true
    )
    return "sessions/\(sessionId)/page-\(UUID().uuidString).jpg"
  }

  static func save(_ image: UIImage, sessionId: String) throws -> [String: Any] {
    let longest = max(image.size.width, image.size.height)
    let scale: CGFloat = longest > 2048 ? 2048 / longest : 1
    let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    // Drawing into a new context also makes the image upright.
    let scaled = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let data = scaled.jpegData(compressionQuality: 0.8) else {
      throw Exception(name: "Pages", description: "could not encode the page", code: "bad_image")
    }
    let path = newPagePath(sessionId: sessionId)
    try data.write(to: documents.appendingPathComponent(path))
    return ["file": path, "width": Double(size.width), "height": Double(size.height)]
  }

  static func importImage(sessionId: String, sourceUri: String) throws -> [String: Any] {
    guard let url = URL(string: sourceUri), let image = UIImage(contentsOfFile: url.path) else {
      throw Exception(name: "Pages", description: "could not read the picked image", code: "bad_image")
    }
    return try save(image, sessionId: sessionId)
  }
}
