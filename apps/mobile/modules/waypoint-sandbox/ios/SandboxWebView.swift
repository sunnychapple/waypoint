import ExpoModulesCore
import WebKit

// The locked web view behind WaypointSandbox (M25b, M25c). Five layers, all enforced here, and nothing loads if the first
// one cannot be set up (fails closed):
// 1. a WKContentRuleList that blocks every load except about:blank and data:, added before the first load;
// 2. the page's own Content-Security-Policy meta (src/core/made/sandbox.ts);
// 3. a user script at document start that removes the network and storage APIs (CSP does not cover WebRTC,
//    sendBeacon or workers) and blocks frames, objects and embeds made at run time (M25c);
// 4. a non-persistent data store, no script message handler, no new windows, and a navigation delegate that allows
//    only the view's own first about:blank load and cancels everything else;
// 5. Lockdown Mode for the view (M25c): WebRTC, WebAssembly, Web Audio and other complex APIs are off in every frame,
//    including a frame's window the user script never ran in.
final class SandboxWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  var page: String = ""
  var mermaid: Bool = false

  // WebKit has no alternation in url-filter, so the allowed schemes are three rules: block everything, then re-allow.
  private static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^about:blank"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}}]"#

  // Layer 3 (M25c): removes the network and storage APIs, and stops the page from making a frame, object or embed (a
  // frame whose load is cancelled keeps a window this script never runs in). Runs at document start in every frame.
  private static let guardScript = #"""
    (function () {
      "use strict";
      // Captured before any page script runs, so a page that patches prototypes cannot change what the checks call.
      var apply = Reflect.apply, define = Object.defineProperty, getDesc = Object.getOwnPropertyDescriptor;
      var lower = String.prototype.toLowerCase, indexOf = String.prototype.indexOf, lastIndexOf = String.prototype.lastIndexOf;
      var slice = String.prototype.slice, charCodeAt = String.prototype.charCodeAt, Str = String, TypeErr = TypeError;
      var NAMES = ["iframe", "frame", "frameset", "object", "embed", "portal", "applet", "meta", "link", "base"];
      function blocked() { throw new TypeErr("Blocked in the sandbox"); }
      function blockedName(name) {
        var n = apply(lower, name, []), i = apply(lastIndexOf, n, [":"]);
        if (i >= 0) n = apply(slice, n, [i + 1]);
        for (var k = 0; k < NAMES.length; k++) if (n === NAMES[k]) return true;
        return false;
      }
      // True when the markup could open one of NAMES as a tag: "<name" or "prefix:name", then a space, "/", ">" or the end.
      function blockedMarkup(text) {
        var s = apply(lower, text, []);
        for (var k = 0; k < NAMES.length; k++) {
          var at = 0;
          for (;;) {
            var i = apply(indexOf, s, [NAMES[k], at]);
            if (i < 0) break;
            at = i + 1;
            var before = i > 0 ? apply(charCodeAt, s, [i - 1]) : 0, after = i + NAMES[k].length;
            var next = after < s.length ? apply(charCodeAt, s, [after]) : 32;
            if ((before === 60 || before === 58) && (next <= 32 || next === 47 || next === 62)) return true;
          }
        }
        return false;
      }
      function text(v) { var s = v === null ? "" : Str(v); if (blockedMarkup(s)) blocked(); return s; }
      function method(proto, key, wrap) {
        var d = proto && getDesc(proto, key);
        if (d && typeof d.value === "function") define(proto, key, { value: wrap(d.value), writable: false, configurable: false });
      }
      function setter(proto, key) {
        var d = proto && getDesc(proto, key);
        if (d && d.set) {
          var set = d.set;
          define(proto, key, { get: d.get, set: function (v) { apply(set, this, [text(v)]); }, configurable: false });
        }
      }
      function gone(target, key) { try { define(target, key, { value: undefined, writable: false, configurable: false }); } catch (e) {} }

      ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "Worker",
       "SharedWorker", "caches", "indexedDB", "localStorage", "sessionStorage", "XSLTProcessor", "WebTransport",
       "HTMLIFrameElement", "HTMLFrameElement", "HTMLFrameSetElement", "HTMLObjectElement", "HTMLEmbedElement"].forEach(function (k) { gone(window, k); });
      gone(navigator, "sendBeacon"); gone(navigator, "serviceWorker"); gone(navigator, "clipboard");

      // No frame-like element can be made at run time, by name or from markup.
      method(Document.prototype, "createElement", function (f) { return function (name, options) {
        var n = Str(name); if (blockedName(n)) blocked(); return apply(f, this, [n, options]); }; });
      method(Document.prototype, "createElementNS", function (f) { return function (ns, name, options) {
        var n = Str(name); if (blockedName(n)) blocked(); return apply(f, this, [ns, n, options]); }; });
      [Element.prototype, typeof ShadowRoot === "function" ? ShadowRoot.prototype : null].forEach(function (p) {
        setter(p, "innerHTML");
        ["setHTMLUnsafe", "setHTML"].forEach(function (k) { method(p, k, function (f) { return function (h, o) { return apply(f, this, [text(h), o]); }; }); });
      });
      setter(Element.prototype, "outerHTML");
      method(Element.prototype, "insertAdjacentHTML", function (f) { return function (where, h) { return apply(f, this, [where, text(h)]); }; });
      method(Range.prototype, "createContextualFragment", function (f) { return function (h) { return apply(f, this, [text(h)]); }; });
      method(Document, "parseHTMLUnsafe", function (f) { return function (h, o) { return apply(f, this, [text(h), o]); }; });
      ["write", "writeln"].forEach(function (k) { method(Document.prototype, k, function (f) { return function () {
        var parts = []; for (var i = 0; i < arguments.length; i++) parts[i] = text(arguments[i]); return apply(f, this, parts); }; }); });
      method(Document.prototype, "execCommand", function (f) { return function (cmd, ui, value) {
        var c = Str(cmd), v = value === undefined ? value : text(value); return apply(f, this, [c, ui, v]); }; });
      // XML parsing can build elements from entities, so DOMParser takes HTML only.
      method(DOMParser.prototype, "parseFromString", function (f) { return function (h, type) {
        var t = Str(type); if (t !== "text/html") blocked(); return apply(f, this, [text(h), t]); }; });
      method(DataTransfer.prototype, "setData", function (f) { return function (type, data) { return apply(f, this, [Str(type), text(data)]); }; });

      // Backstop: a frame-like element that reaches the document anyway is removed at the next microtask.
      var qsa = Document.prototype.querySelectorAll, remove = Element.prototype.remove, MO = MutationObserver;
      var count = getDesc(NodeList.prototype, "length").get, item = NodeList.prototype.item;
      var SEL = "iframe,frame,frameset,object,embed,portal,applet";
      new MO(function () {
        var found = apply(qsa, document, [SEL]);
        for (var i = apply(count, found, []) - 1; i >= 0; i--) apply(remove, apply(item, found, [i]), []);
      }).observe(document, { childList: true, subtree: true });
    })();
    """#

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
    configuration.defaultWebpagePreferences.isLockdownModeEnabled = true
    configuration.userContentController.addUserScript(
      WKUserScript(source: guardScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
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
