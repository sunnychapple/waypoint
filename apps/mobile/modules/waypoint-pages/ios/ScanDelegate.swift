import UIKit
import VisionKit

/// Receives the pages from the document camera and saves each one as a JPEG.
final class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  private let sessionId: String
  private let done: (Result<[[String: Any]], Error>) -> Void

  init(sessionId: String, done: @escaping (Result<[[String: Any]], Error>) -> Void) {
    self.sessionId = sessionId
    self.done = done
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    let sessionId = self.sessionId
    let done = self.done
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        var pages: [[String: Any]] = []
        for i in 0..<scan.pageCount {
          pages.append(try PageStore.save(scan.imageOfPage(at: i), sessionId: sessionId))
        }
        DispatchQueue.main.async { done(.success(pages)) }
      } catch {
        DispatchQueue.main.async { done(.failure(error)) }
      }
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    done(.success([]))
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    done(.failure(error))
  }
}
