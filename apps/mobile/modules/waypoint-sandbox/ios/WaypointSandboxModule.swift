import ExpoModulesCore

// The locked web view for diagrams and mini apps (M25b). Thin: the work is in SandboxWebView.swift.
public class WaypointSandboxModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WaypointSandbox")

    View(SandboxWebView.self) {
      Prop("page") { (view: SandboxWebView, page: String) in
        view.page = page
        view.scheduleRender()
      }
      Prop("mermaid") { (view: SandboxWebView, on: Bool) in
        view.mermaid = on
        view.scheduleRender()
      }
    }
  }
}
