// The sandbox gate page (M25b), the same text as modules/waypoint-sandbox/gate/gate.html. Metro cannot import .html,
// so test/sandbox.test.ts checks that the two are equal. HOST is replaced by the dev screen with the Mac's address.
// Two copies of the word import are written with a \x69 escape, so test/boundaries.test.ts does not read them as imports.
// The text is the same.
export const GATE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Sandbox gate</title>
<link rel="dns-prefetch" href="//HOST">
<link rel="preconnect" href="http://HOST:8999">
<link rel="prefetch" href="http://HOST:8999/link-prefetch">
<link rel="stylesheet" href="http://HOST:8999/link-css">
<style>
  @import url("http://HOST:8999/css-\x69mport");
  @font-face { font-family: x; src: url("http://HOST:8999/font"); }
  body { font: 14px -apple-system; background: url("http://HOST:8999/css-bg"); }
  .f { font-family: x; }
</style>
<meta http-equiv="refresh" content="3; url=http://HOST:8999/meta-refresh">
</head>
<body>
<p id="marker">script: not run</p>
<h3>Sandbox gate</h3><div class="f">font probe</div><ol id="out"></ol>
<img src="http://HOST:8999/img">
<img srcset="http://HOST:8999/srcset 2x">
<iframe src="http://HOST:8999/iframe"></iframe>
<object data="http://HOST:8999/object"></object>
<video src="http://HOST:8999/video" autoplay muted></video>
<audio src="http://HOST:8999/audio" autoplay></audio>
<a id="ping" href="#" ping="http://HOST:8999/a-ping">ping</a>
<form id="form" action="http://HOST:8999/form" method="post"><input name="x" value="1"></form>
<script>
document.getElementById("marker").textContent = "script: ran";
const H = "http://HOST:8999/";
const out = document.getElementById("out");
const say = (name, result) => { const li = document.createElement("li"); li.textContent = name + ": " + result; out.appendChild(li); };
const probe = async (name, run) => { try { await run(); say(name, "no error (check the server log)"); } catch (e) { say(name, "blocked (" + (e && e.name) + ")"); } };
probe("fetch", () => fetch(H + "fetch"));
probe("xhr", () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("GET", H + "xhr"); x.onload = ok; x.onerror = () => no(new Error("xhr")); x.send(); }));
probe("websocket", () => new Promise((ok, no) => { const w = new WebSocket("ws://HOST:8999/ws"); w.onopen = ok; w.onerror = () => no(new Error("ws")); }));
probe("eventsource", () => new Promise((ok, no) => { const s = new EventSource(H + "sse"); s.onopen = ok; s.onerror = () => no(new Error("sse")); }));
probe("beacon", () => { if (!navigator.sendBeacon(H + "beacon", "x")) throw new Error("beacon"); });
probe("webrtc", async () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:HOST:3478" }] }); pc.createDataChannel("x"); await pc.setLocalDescription(await pc.createOffer()); });
probe("worker", () => new Worker("data:text/javascript,fetch('" + H + "worker')"));
probe("\x69mport", () => import(H + "import.js"));
probe("image", () => new Promise((ok, no) => { const i = new Image(); i.onload = ok; i.onerror = () => no(new Error("img")); i.src = H + "js-image"; }));
probe("window.open", () => { if (window.open(H + "open") === null) throw new Error("open"); });
const storage = (name, run) => { try { const v = run(); say(name, v === undefined ? "blocked (undefined)" : "NOT BLOCKED"); } catch (e) { say(name, "blocked (" + (e && e.name) + ")"); } };
storage("localStorage", () => { localStorage.setItem("gate", "1"); return localStorage.getItem("gate"); });
storage("sessionStorage", () => { sessionStorage.setItem("gate", "1"); return sessionStorage.getItem("gate"); });
storage("indexedDB", () => indexedDB.open("gate"));
storage("caches", () => caches);
document.cookie = "gate=1";
say("cookie", document.cookie ? "NOT BLOCKED" : "blocked (empty)");
const realm = (name, w) => {
  ["fetch", "RTCPeerConnection", "WebSocket", "Worker"].forEach((k) => {
    try { say(name + " " + k, typeof w[k] === "undefined" ? "blocked (undefined)" : "NOT BLOCKED"); } catch (e) { say(name + " " + k, "blocked (" + (e && e.name) + ")"); }
  });
};
const make = (name, run) => { try { run(); say(name, "NOT BLOCKED"); } catch (e) { say(name, "blocked (" + (e && e.name) + ")"); } };
const F = '<iframe src="' + H + 'made-frame"></iframe>';
const box = document.createElement("div"); document.body.appendChild(box);
make("make iframe", () => document.body.appendChild(document.createElement("iframe")));
make("make iframe (namespace)", () => document.body.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "iframe")));
make("make object", () => document.body.appendChild(document.createElement("object")));
make("make embed", () => document.body.appendChild(document.createElement("embed")));
make("make meta", () => document.head.appendChild(document.createElement("meta")));
make("innerHTML frame", () => { box.innerHTML = F; });
make("insertAdjacentHTML frame", () => box.insertAdjacentHTML("beforeend", F));
make("DOMParser frame", () => box.appendChild(document.adoptNode(new DOMParser().parseFromString(F, "text/html").body.firstChild)));
make("DOMParser xml", () => new DOMParser().parseFromString("<a/>", "application/xml"));
make("createContextualFragment frame", () => box.appendChild(document.createRange().createContextualFragment(F)));
make("document.write frame", () => document.write(F));
make("XSLTProcessor", () => new XSLTProcessor());
say("bridge", window.webkit && window.webkit.messageHandlers && Object.keys(window.webkit.messageHandlers).length ? "NOT BLOCKED" : "none");
setTimeout(() => {
  say("frames", window.length === 0 ? "none" : window.length + " NOT BLOCKED");
  for (let i = 0; i < window.length; i++) realm("window.frames[" + i + "]", window.frames[i]);
  say("lockdown", typeof WebAssembly === "undefined" ? "on" : "OFF (NOT BLOCKED)");
}, 300);
setTimeout(() => { document.getElementById("ping").click(); document.getElementById("form").submit(); }, 500);
setTimeout(() => { location.href = H + "location"; }, 1000);
setTimeout(() => { location.href = "waypoint://gate"; }, 1500);
</script>
</body>
</html>
`;
