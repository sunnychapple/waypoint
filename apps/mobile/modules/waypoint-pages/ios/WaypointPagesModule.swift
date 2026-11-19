import ExpoModulesCore
import VisionKit

public class WaypointPagesModule: Module {
  private var scan: ScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("WaypointPages")

    Function("isScannerSupported") { () -> Bool in VNDocumentCameraViewController.isSupported }

    AsyncFunction("scanPages") { (sessionId: String, promise: Promise) in
      guard self.scan == nil else { promise.reject("busy", "The camera is already open"); return }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("no_view", "Nothing to show the camera from"); return
      }
      let camera = VNDocumentCameraViewController()
      let delegate = ScanDelegate(sessionId: sessionId) { [weak self] result in
        camera.dismiss(animated: true)
        self?.scan = nil
        switch result {
        case .success(let pages): promise.resolve(pages)
        case .failure(let error): promise.reject("scan_failed", error.localizedDescription)
        }
      }
      self.scan = delegate
      camera.delegate = delegate
      presenter.present(camera, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("readPage") { (file: String) async throws -> [String: Any] in try await PageReader.read(file: file) }

    AsyncFunction("importImage") { (sessionId: String, sourceUri: String) throws -> [String: Any] in
      try PageStore.importImage(sessionId: sessionId, sourceUri: sourceUri)
    }
  }
}
