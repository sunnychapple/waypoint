import ExpoModulesCore
import WebKit

// The locked web view behind WaypointSandbox (M25b). Four layers, all enforced here, and nothing loads if the first
// one cannot be set up (fails closed):
// 1. a WKContentRuleList that blocks every load except about:blank and data:, added before the first load;
// 2. the page's own Content-Security-Policy meta (src/core/made/sandbox.ts);
// 3. a user script at document start that removes the network and storage APIs (CSP does not cover WebRTC,
//    sendBeacon or workers);
// 4. a non-persistent data store, no script message handler, no new windows, and a navigation delegate that allows
//    only the view's own first about:blank load and cancels everything else.
final class SandboxWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  var page: String = ""
  var mermaid: Bool = false

  // WebKit has no alternation in url-filter, so the allowed schemes are three rules: block everything, then re-allow.
  private static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^about:blank"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}}]"#

  private static let removeApis = #"["fetch","XMLHttpRequest","WebSocket","EventSource","RTCPeerConnection","webkitRTCPeerConnection","Worker","SharedWorker","caches","indexedDB","localStorage","sessionStorage"].forEach(function(k){try{Object.defineProperty(window,k,{value:undefined,configurable:false,writable:false})}catch(e){}});try{Object.defineProperty(navigator,"sendBeacon",{value:undefined});Object.defineProperty(navigator,"serviceWorker",{value:undefined})}catch(e){}"#

  // Mermaid's bundled browser script, or nil when it is missing from the module (then nothing is shown).
  private static let mermaidScript: String? = {
    guard let bundleURL = Bundle(for: SandboxWebView.self).url(forResource: "WaypointSandbox", withExtension: "bundle"),
          let bundle = Bundle(url: bundleURL),
          let url = bundle.url(forResource: "mermaid.min", withExtension: "js"),
          let text = try? String(contentsOf: url, encoding: .utf8)
    else { return nil }
    return text
  }()

  private let webView: WKWebView
  private var ruleListAdded = false
  // Set just before our own loadHTMLString, and cleared by the first navigation it allows.
  private var allowLoad = false
  private var renderScheduled = false

  required init(appContext: AppContext? = nil) {
    webView = WKWebView(frame: .zero, configuration: SandboxWebView.makeConfiguration())
    super.init(appContext: appContext)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isInspectable = false
    #if DEBUG
    webView.isInspectable = true
    #endif
    webView.scrollView.minimumZoomScale = 1
    webView.scrollView.maximumZoomScale = 5
    webView.frame = bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(webView)
  }

  private static func makeConfiguration() -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    configuration.userContentController.addUserScript(
      WKUserScript(source: removeApis, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    return configuration
  }

  // Props arrive together; one render after they have all been set.
  func scheduleRender() {
    if renderScheduled { return }
    renderScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.renderScheduled = false
      self.render()
    }
  }

  private func render() {
    guard !page.isEmpty else { return }
    var html = page
    if mermaid {
      // Only the first marker: the marker comes before the diagram source, so a label that contains it is inert.
      guard let script = SandboxWebView.mermaidScript,
            let marker = page.range(of: "/*MERMAID*/")
      else { return }
      html = page.replacingCharacters(in: marker, with: script)
    }
    ensureRules { [weak self] in
      guard let self else { return }
      self.allowLoad = true
      self.webView.loadHTMLString(html, baseURL: nil)
    }
  }

  // Compiles and adds the rule list once, before the first load. If it fails, nothing is loaded.
  private func ensureRules(then load: @escaping () -> Void) {
    if ruleListAdded {
      load()
      return
    }
    WKContentRuleListStore.default().compileContentRuleList(
      forIdentifier: "waypoint-sandbox", encodedContentRuleList: SandboxWebView.rules
    ) { [weak self] list, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        // Nothing is loaded without the list. The log line carries no address, page or error text.
        guard let list else {
          NSLog("WaypointSandbox: the content rules could not be compiled, so nothing is shown")
          return
        }
        self.webView.configuration.userContentController.add(list)
        self.ruleListAdded = true
        load()
      }
    }
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let url = navigationAction.request.url?.absoluteString
    let isOwnLoad = allowLoad && navigationAction.targetFrame?.isMainFrame == true && url == "about:blank"
    // Frames a page creates (srcdoc, or a blank frame) must run the user script and inherit the CSP; they load nothing else.
    let isEmptyFrame = navigationAction.targetFrame?.isMainFrame == false && (url == "about:blank" || url == "about:srcdoc")
    if isOwnLoad {
      allowLoad = false
      decisionHandler(.allow)
    } else if isEmptyFrame {
      decisionHandler(.allow)
    } else {
      decisionHandler(.cancel)
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    // Reported without the address or the page: both can hold the student's notes.
    NSLog("WaypointSandbox: the page could not be loaded")
  }

  // No new windows, ever.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }
}
