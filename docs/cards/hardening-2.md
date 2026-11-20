# Hardening 3 (review round 2): mini-app isolation (M25c) and mobile follow-ups (H8)

These cards come from the second round of review notes. Each note was checked against `main` at `e3f7427` (after PR #115, M25b) and against the Sonnet review and re-check comments on its PR. The account certificate note from the M28a review is not repeated here: H7a and H7b fixed it (`docs/cards/hardening-2-account-cert.md`).

Owner's rule for this round: fix what is real and skip over-engineering. Every skip has its reason in the table.

## Verdicts

| Note | PR | Verdict | What happens |
|---|---|---|---|
| M25b: a cancelled `<iframe src>` or an `<object>` in a mini app leaves a frame window where the user script never ran, with `RTCPeerConnection` (STUN packets escaped) | #115 | **FIX** | Card **M25c**. Reproduced on `main`'s configuration in a macOS WebKit harness: 14 of 30 ways out sent STUN packets (130 in all). |
| M25b: the `bridge` probe prints two lines | #115 | **FIX** | M25c (the gate block is rewritten anyway). |
| M25b card text is stale (rule list, storage step, "Diagrams are not behind the flag") | #115 | **FIX** (docs) | Done in this pull request, in `docs/cards/mobile-stage3-4.md`, M25b. |
| M25b: no test covers the `mini_app_viewer` and `diagram_viewer` flags | #115 | **SKIP** | Each is one `useConfig()?.flags.x === true` read in four screens, and the reviewer checked all four. Vitest covers only `src/core/`, and there is no hook test setup. A shared helper only to test it is more code than the check. |
| M27b-A: `adoptAccountKey` and `recoverAccountKey` leave `pendingAccountKey`/`pendingAccountId` in the Keychain item | #100 | **FIX** | H8, part 1. Still on `main` (`AccountOps.swift`). |
| M16: after a paid follow-up whose local save fails, the key is kept, so the next tap gets 409 then a paid "Try again" | #103 | **FIX** | H8, part 2. Still on `main` (`useExplain.ts`, the `catch` after `writeDb`). |
| M16: `settleFailedSent` is skipped when a double-check fails after the sheet closed | #103 | **SKIP** | The `sent_log` row then says "Waiting for the answer", which is true (the app does not know). Writing "Not charged" there needs telling a failed reply from an aborted stream, which the server still charges; getting that wrong would show "Not charged" for a charge. It is M15's pattern, the reviewer marked it note-only, and no money is lost. |
| M34: cancel after the server finished leaves the job "Getting the result" forever, charge kept | #105 | **FIX** | H8, part 3: ask the server first; a finished job is fetched, not deleted. The leftover race gets an honest line. |
| M34: a push tap for a job not in the local table shows an empty screen | #105 | **FIX** | H8, part 3: one caption. |
| M20: push taps never match (`kind`/`ref` are top level) | #105 | **ALREADY FIXED** | `src/platform/push.ts` `pushData` reads `trigger.payload` (M27b-C), and every action, `job_ready` included, goes through it. |
| M25a: "Show what's sent" leaves out the focus text, which is sent and logged | #107 | **FIX** | H8, part 4: one line under the text. |
| M25a: test gaps (`fromRow` drops bad rows, newest first, cascade on session delete, `answerKey` decimal) | #107 | **TEST-ONLY** | H8, part 4: four tests, each kills the reviewer's mutant. |
| M3b: job create with `retry: true` is safe only while the server is idempotent on Idempotency-Key | #98 | **ALREADY FIXED** (covered) | `apps/api/test/jobs.test.ts` pins it: "the same key and body again gives the stored 201 … one create and one hold" and "the same key after its idempotency row is deleted gives the same job, one create and one hold". `audio-routes.test.ts` pins `audio/done`. A route that loses this fails those tests. Nothing to add. |
| M3c: React Native `fetch` must send `Content-Length` for `POST /v1/blobs` | #101 | **FIX** (docs) | Done in this pull request: M29b's device check (step 5) now says to look for it. Only a device can show it, and M29b is the first card that uploads a blob. |
| M22b: the device check must print the chosen voice pair (the iOS list differs from the Mac's) | #114 | **FIX** (docs + dev screen) | The novelty-voice filter itself is already fixed in #114. M22b's device check (step 4) now says to record the `voices` string; done in this pull request. The dev screen that check names (`src/app/dev/voices.tsx`) was never built (it is not in the card's file list), so H8, part 5 adds it. |

Counts: FIX 10 (three of them docs, done in this pull request), TEST-ONLY 1, SKIP 2, ALREADY FIXED 2.

## Order

| Card | Branch | Area | Merge after |
|---|---|---|---|
| M25c | `fix/m25c-miniapp-isolation` | `waypoint-sandbox` (Swift, gate), `src/core/made/`, the dev gate screen, one line of the mini-app prompt | `main` at `e3f7427` or later |
| H8 | `fix/h8-mobile-review-2` | `waypoint-keys` (two functions), explain, jobs, made, a dev screen | `main` at `e3f7427` or later |

The two cards touch different files and can be built at the same time. **`mini_app_viewer` and `diagram_viewer` stay `false` in KV until M25c's device gate passes on a real iPhone** (zero HTTP requests, zero UDP packets).

Every block marked **exactly** was applied to a copy of `main` at `e3f7427` and checked there: `npm run typecheck`; `npm test` (mobile 337 = 326 + 11 new; the rest unchanged); `npm run export:ios -w @waypoint/mobile`; `npm run test:swift -w @waypoint/mobile` (55); `swiftc -parse` on `SandboxWebView.swift`; and `swiftc -typecheck -target arm64-apple-macos15 Core/*.swift IdentityStore.swift AccountOps.swift` in `apps/mobile/modules/waypoint-keys/ios`. The copy was then deleted.

---

## M25c · Mini apps that cannot open an unguarded window

### Why

A mini app is HTML and JavaScript that a model wrote from the student's notes, and from whatever the notes quoted. M25b locks the web view in four layers, but the re-check of PR #115 found a gap. A frame whose navigation is cancelled (an `<iframe src="https://…">`, an `<object data>`) keeps its first empty window. WebKit never runs the user script in that window, so `frame.contentWindow.RTCPeerConnection` is still there. WebRTC is not a URL load, so neither the content rules nor CSP stop it, and its STUN packets (and a DNS lookup for a `stun:` host name) leave the phone. That is a data path for the notes.

### Design: three layers on top of M25b, each enough against the escapes found so far

1. **Lockdown Mode for the sandbox view** (native; `configuration.defaultWebpagePreferences.isLockdownModeEnabled = true`, public API since iOS 16). This is a WebKit setting for the whole page, not a script, so it applies in **every** frame, including a frame's first window that the user script never sees. With it, `RTCPeerConnection` is `undefined` in every realm. It also turns off WebAssembly, Web Audio, WebGL, MathML, gamepads, in-page speech and the JavaScript JIT. A mini app gives up sound and 3D, and Mermaid gets slower but still draws: 131 ms for a flowchart on the Mac.
2. **The mini-app HTML is rebuilt before it is loaded** (`src/core/made/miniAppHtml.ts`, TypeScript core, tested). A small tokenizer reads the model's HTML, and the page is written again from scratch: allow-listed tags only, attribute names `[a-z][a-z0-9-]*`, double-quoted values, and text and values with `<` and `>` escaped. Script text goes into a JSON string (with `<` escaped), and a one-line loader runs it in place, in the global scope. A `<style>` that contains `<` is dropped. So every `<` in the output starts a tag the sanitizer chose, and how the browser would have parsed the original input does not matter (no regex sanitizing, no parser differential). `iframe`, `frame`, `frameset`, `object`, `embed`, `portal`, `applet`, `meta` (so every `http-equiv`), `link`, `base`, `svg`, `math`, `template` and the raw-text elements a mini app does not need are not in the list. A test parses the output with parse5, a parser that follows the HTML standard, and checks that only allowed elements come out. On the Mac, 200,000 random tag-soup inputs gave 0 failures.
3. **The user script blocks making those elements at run time**, and removes the rest at the next microtask. It patches `Document.prototype.createElement` and `createElementNS`, and checks the markup given to the `innerHTML` and `outerHTML` setters (Element and ShadowRoot), `insertAdjacentHTML`, `setHTMLUnsafe`/`setHTML`, `Document.parseHTMLUnsafe`, `document.write`/`writeln`, `execCommand` values, `Range.createContextualFragment`, `DOMParser.parseFromString` (`text/html` only, because XML entities can build elements) and `DataTransfer.setData`. It also removes `XSLTProcessor`, `WebTransport`, `navigator.clipboard` and the `HTMLIFrameElement`, `HTMLFrameElement`, `HTMLFrameSetElement`, `HTMLObjectElement` and `HTMLEmbedElement` constructors. Everything it calls is captured before the page runs, through `Reflect.apply`, so a page that patches `String.prototype`, `RegExp.prototype` or `Function.prototype.call` cannot switch a check off. A name is converted to a string once and that same string is passed on, so a `toString` that changes its answer cannot slip through. A `MutationObserver` removes any frame-like element that reaches the document anyway, before the next parser-inserted script runs.

The gate keeps M25b's probes. It also tries each way of making a frame at run time (each must say "blocked"), counts frames (must be "none"), and checks that Lockdown Mode is on. On the iPhone, a UDP listener on the Mac must see nothing.

**Is a JavaScript mini app safe enough?** Yes, with Lockdown Mode as the control that does not depend on knowing every DOM API. Layers 2 and 3 make sure no unguarded window exists at all. What is left: a future WebKit API that parses HTML into the live page and is not on layer 3's list could again make a frame. Lockdown Mode still keeps WebRTC out of that frame, and the content rules still block its loads. The device gate is what proves this on iOS. If the gate ever shows `lockdown: OFF` or a UDP packet on a real iPhone, keep `mini_app_viewer` off and ask the owner to choose a fallback: mini apps without JavaScript (`allowsContentJavaScript = false`, CSS-only interactions), or mini apps as data (quiz, sort, slider specs) drawn by native screens.

### What the macOS harness showed

This was a throwaway Swift harness on macOS 15.7 WebKit, deleted afterwards. It used the real rule list, the non-persistent store, the `decidePolicyFor` logic and the user script from `SandboxWebView.swift`, plus a logging TCP server on 8999/8998 and UDP listeners on 3478 to 3529 (one port per case). It ran 30 attack cases: static `iframe`/`object`/`embed`, `svg>p>iframe` and `svg>style>embed` breakouts, `createElement`/`createElementNS`, `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `DOMParser` (HTML, and XML with a character-reference entity that builds an `HTMLIFrameElement`), `createContextualFragment`, `setHTMLUnsafe`, `Document.parseHTMLUnsafe`, `template` plus `importNode`, `shadowRoot.innerHTML`, `execCommand("insertHTML")`, `document.write`, `XSLTProcessor`, a `toString` time-of-check trick, patched `RegExp`/`String`/`Function.prototype.call`, preconnect and dns-prefetch links, meta refresh, srcdoc and `window.open`.

| Configuration | Frames left | UDP (STUN) packets | TCP connections |
|---|---|---|---|
| `main` today (M25b user script) | many | **130, from 14 cases** | 0 |
| `main` + Lockdown Mode only | many, all with `RTCPeerConnection` undefined | 0 | 0 |
| M25c user script only (input not sanitized) | 0 in all 30 cases | 0 | 0 |
| M25c: sanitizer + user script + Lockdown Mode | 0 | 0 | 0 |

Also on the full M25c configuration:
- A typical flashcard app worked: `DOMContentLoaded`, `onclick`, `innerHTML` rendering, canvas, an SVG built with `createElementNS`, `if (i<5)`. Storage stayed blocked.
- Mermaid drew a flowchart in 131 ms.
- An unguarded frame window under Lockdown Mode (old user script) reached nothing with `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, `Image`, `Worker`, `WebTransport`, a preconnect link or a CSS `url()`.
- The new gate passed both ways, loaded raw and as a mini app: every line blocked, `frames: none`, `lockdown: on`, empty server log, no UDP.
- The same gate against `main`'s configuration printed 12 "NOT BLOCKED" creation lines, `frames: 9 NOT BLOCKED` and `lockdown: OFF`, so the gate cannot pass by accident.
- Not covered: DNS prefetch (a lookup cannot be seen without root on the Mac). A dynamic `x-dns-prefetch-control` meta is blocked by layer 3 (`meta` cannot be made). A cloned existing `meta` is not blocked, and `<a href>` prefetching depends on WebKit's DNS-prefetch setting. Instruments on the device covers it.

### Card

Branch `fix/m25c-miniapp-isolation`. From `main` at `e3f7427`. Follows `AGENTS.md`. Dependency: `parse5` **8.0.1** as a dev dependency of `@waypoint/mobile` (published 2026-04-19, MIT, tests only). Files, and no others:

- `apps/mobile/src/core/made/miniAppHtml.ts` (new), `apps/mobile/test/miniAppHtml.test.ts` (new)
- `apps/mobile/src/core/made/sandbox.ts`, `apps/mobile/test/sandbox.test.ts` (one line)
- `apps/mobile/modules/waypoint-sandbox/ios/SandboxWebView.swift`
- `apps/mobile/modules/waypoint-sandbox/gate/gate.html`, `apps/mobile/src/core/made/gate.ts` (the same change)
- `apps/mobile/src/app/dev/sandbox.tsx`
- `apps/mobile/package.json` (one dev dependency; add the line by hand after `"@types/react"`, then run `npm install` from the root, so npm does not reorder the file), `package-lock.json`
- `apps/api/src/jobs/write.ts` (one prompt line)

#### 1. `apps/mobile/src/core/made/miniAppHtml.ts`, exactly

```ts
// A model's mini-app HTML, rebuilt before the locked web view loads it (M25c). The input is read with a small
// tokenizer and written out again from scratch: only allow-listed tags, with plain attribute names and double-quoted
// values; text and values with < and > escaped; each script moved into a JSON string that a tiny loader runs in
// place. So every "<" in the output starts a tag this file chose, whatever a browser would have made of the input.
// No frame, object, embed, meta, link, base, svg or math element survives, so the page cannot open a window that the
// user script misses.

// JSON that is safe inside <script>: "<" never appears, so "</script>" cannot end the script.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const ALLOWED = new Set(
  ("a abbr address article aside b bdi bdo blockquote br button canvas caption cite code col colgroup data datalist dd " +
    "del details dfn dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img " +
    "input ins kbd label legend li main mark menu meter nav ol optgroup option output p pre progress q rp rt ruby s samp " +
    "section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr").split(" "),
);
const VOID = new Set(["br", "col", "hr", "img", "input", "wbr"]);
// A browser reads these as text up to their end tag; so does this tokenizer. Only script, style and textarea are kept.
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;
const DROPPED_ATTRIBUTES = new Set(["srcdoc", "http-equiv", "shadowrootmode", "ping"]);
// Runs a script's text where the script was, in the page's global scope.
const RUN = '(function(s){var e=document.createElement("script");e.textContent=s;document.currentScript.after(e)})';

type Tag = { name: string; end: boolean; attributes: [string, string][]; next: number };

const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\f";
const isAlpha = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
// ASCII only, one character for one, so indexes into the lowered text match the original.
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The tag that starts at s[i] ("<name" or "</name"), or null when the input ends inside it (a browser drops it too).
function readTag(s: string, i: number): Tag | null {
  const end = s[i + 1] === "/";
  let j = i + (end ? 2 : 1);
  let name = "";
  while (j < s.length && !isSpace(s[j]) && s[j] !== "/" && s[j] !== ">") name += s[j++];
  const attributes: [string, string][] = [];
  for (;;) {
    while (isSpace(s[j]) || s[j] === "/") j++;
    if (j >= s.length) return null;
    if (s[j] === ">") return { name: asciiLower(name), end, attributes, next: j + 1 };
    let key = s[j++] ?? "";
    while (j < s.length && !isSpace(s[j]) && s[j] !== "/" && s[j] !== ">" && s[j] !== "=") key += s[j++];
    while (isSpace(s[j])) j++;
    let value = "";
    if (s[j] === "=") {
      j++;
      while (isSpace(s[j])) j++;
      const quote = s[j];
      if (quote === '"' || quote === "'") {
        const close = s.indexOf(quote, j + 1);
        if (close < 0) return null;
        value = s.slice(j + 1, close);
        j = close + 1;
      } else {
        while (j < s.length && !isSpace(s[j]) && s[j] !== ">") value += s[j++];
      }
    }
    attributes.push([asciiLower(key), value]);
  }
}

function openTag(tag: Tag): string {
  let out = `<${tag.name}`;
  const seen = new Set<string>();
  for (const [key, value] of tag.attributes) {
    if (seen.has(key)) continue; // a browser keeps the first of two equal names
    seen.add(key);
    if (!ATTRIBUTE_NAME.test(key) || DROPPED_ATTRIBUTES.has(key)) continue;
    out += ` ${key}="${escapeText(value).replace(/"/g, "&quot;")}"`;
  }
  return `${out}>`;
}

// The text of a raw-text element that starts at i, up to "</name" followed by a space, "/" or ">"; or to the end.
function readRawText(s: string, lower: string, i: number, name: string): { text: string; next: number } {
  for (let from = i; ; ) {
    const at = lower.indexOf(`</${name}`, from);
    const after = at < 0 ? undefined : s[at + 2 + name.length];
    if (after === undefined) return { text: s.slice(i), next: s.length };
    if (isSpace(after) || after === "/" || after === ">") return { text: s.slice(i, at), next: readTag(s, at)?.next ?? s.length };
    from = at + 1;
  }
}

function rawElement(tag: Tag, text: string): string {
  if (tag.name === "script") {
    return tag.attributes.some(([key]) => key === "src") ? "" : `<script>${RUN}(${scriptJson(text)})</script>`;
  }
  // CSS has no use for "<"; without it the style holds no tag however a browser reads it.
  if (tag.name === "style") return text.includes("<") ? "" : `<style>${text}</style>`;
  if (tag.name === "textarea") return `${openTag(tag)}${escapeText(text)}</textarea>`;
  return ""; // title, xmp, iframe, noembed, noframes, noscript: dropped with their text
}

export function sanitizeMiniApp(html: string): string {
  const s = html.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
  const lower = asciiLower(s);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out += escapeText(s.slice(i));
      break;
    }
    out += escapeText(s.slice(i, lt));
    i = lt;
    const next = s[i + 1];
    if (isAlpha(next) || (next === "/" && isAlpha(s[i + 2]))) {
      const tag = readTag(s, i);
      if (!tag) break;
      i = tag.next;
      if (tag.end) {
        if (ALLOWED.has(tag.name) && !VOID.has(tag.name)) out += `</${tag.name}>`;
      } else if (RAW_TEXT.has(tag.name)) {
        const raw = readRawText(s, lower, i, tag.name);
        i = raw.next;
        out += rawElement(tag, raw.text);
      } else if (ALLOWED.has(tag.name)) {
        out += openTag(tag);
      }
    } else if (s.startsWith("<!--", i)) {
      // A comment ends at "-->" or "--!>"; "<!-->" and "<!--->" are empty comments.
      if (s.startsWith("<!-->", i)) i += 5;
      else if (s.startsWith("<!--->", i)) i += 6;
      else {
        const dashes = s.indexOf("-->", i + 4);
        const bang = s.indexOf("--!>", i + 4);
        if (dashes < 0 && bang < 0) i = s.length;
        else if (bang < 0 || (dashes >= 0 && dashes < bang)) i = dashes + 3;
        else i = bang + 4;
      }
    } else if (next === "!" || next === "?" || next === "/") {
      // A doctype, "<?...>" or "</ ...>": dropped up to the next ">".
      const gt = s.indexOf(">", i);
      i = gt < 0 ? s.length : gt + 1;
    } else {
      out += "&lt;";
      i++;
    }
  }
  return out;
}
```

#### 2. `apps/mobile/src/core/made/sandbox.ts`

`scriptJson` moves to `miniAppHtml.ts` (re-exported here, so existing imports keep working), and `miniAppPage` sanitizes. Replace the top of the file, down to and including the end of `scriptJson`, with exactly:

```ts
import { sanitizeMiniApp, scriptJson } from "./miniAppHtml.ts";

export { scriptJson };

// The page a sandboxed web view loads (M25b). Everything here is defence in depth; the native view is the control.
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; " +
  "connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

const HEAD = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">`;

// A model's HTML, rebuilt by sanitizeMiniApp (M25c), after our head: the CSP meta comes first, so it applies before
// anything the HTML contains.
export function miniAppPage(html: string): string {
  return `${HEAD}</head><body>${sanitizeMiniApp(html)}</body></html>`;
}
```

`MERMAID_SCRIPT` and `diagramPage` stay as they are. The diagram page is ours and is not sanitized.

In `test/sandbox.test.ts` the first test looks for the script's text, because the script is now wrapped. Change that one line to:

```ts
    expect(page.indexOf(SANDBOX_CSP)).toBeLessThan(page.indexOf("fetch("));
```

#### 3. `apps/mobile/test/miniAppHtml.test.ts`, exactly

```ts
import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { sanitizeMiniApp } from "../src/core/made/miniAppHtml.ts";
import { miniAppPage } from "../src/core/made/sandbox.ts";

const ALLOWED = new Set(
  ("a abbr address article aside b bdi bdo blockquote br button canvas caption cite code col colgroup data datalist dd " +
    "del details dfn dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img " +
    "input ins kbd label legend li main mark menu meter nav ol optgroup option output p pre progress q rp rt ruby s samp " +
    "section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr " +
    "script style").split(" "),
);
// Elements a browser adds by itself around allowed ones.
const IMPLIED = new Set(["html", "head", "body", "meta"]);

type Node = { nodeName: string; tagName?: string; namespaceURI?: string; childNodes?: Node[]; content?: Node; value?: string };
function elements(node: Node, out: Node[] = []): Node[] {
  if (node.tagName) out.push(node);
  for (const child of node.childNodes ?? []) elements(child, out);
  if (node.content) elements(node.content, out);
  return out;
}
function scriptTexts(node: Node): string[] {
  return elements(node)
    .filter((e) => e.tagName === "script")
    .map((e) => (e.childNodes ?? []).map((c) => c.value ?? "").join(""));
}

const NASTY = [
  '<iframe src="https://x.invalid/a"></iframe>',
  "<IFRAME\tsrc=x>",
  "<iframe/src=x>",
  "<frameset><frame src=x></frameset>",
  '<object data="https://x.invalid/o"><p>fallback</p></object>',
  '<embed src="https://x.invalid/e" type="text/html">',
  "<portal src=x></portal><applet code=x></applet>",
  '<meta http-equiv="refresh" content="0; url=https://x.invalid/">',
  '<link rel="preconnect" href="https://leak.x.invalid"><base href="https://x.invalid/">',
  "<svg><p><iframe src=x></iframe></p></svg>",
  "<svg><style><embed src=x></style></svg>",
  "<math><mi><iframe src=x></iframe></mi></math>",
  "<select><style><input><iframe src=x></style></select>",
  "<select><script><input><iframe src=x></script></select>",
  "<table><style><iframe src=x></style></table>",
  '<script>var s="</script><iframe src=x>"</script>',
  "<script><!--<script></script><iframe src=x></script>",
  "<script>if (a<b) x()</script >",
  "<noscript><iframe src=x></noscript>",
  "<template><iframe src=x></iframe></template>",
  "<textarea></textarea><iframe src=x></textarea>",
  "<title><iframe src=x></title>",
  "<xmp><iframe src=x></xmp><plaintext><iframe src=x>",
  "<!--><iframe src=x>-->",
  "<!-- --!><iframe src=x>",
  "<![CDATA[<iframe src=x>]]>",
  "<p title='a\"><iframe src=x>'>q</p>",
  '<p a="<iframe src=x>" =b c=d>x</p>',
  "<img src=x onerror=alert(1)><iframe",
  "<image src=x><isindex><keygen>",
  "<div srcdoc='<iframe>' shadowrootmode=open xmlns:x=y></div>",
  "a < b > c & d &lt; <3 </ x> </> <?php ?>",
  "<script src=https://x.invalid/s.js></script>",
  "<sc\0ript>x</script><ifr\0ame>",
];

describe("sanitizeMiniApp", () => {
  it("leaves only allowed elements, as a browser's parser reads the output", () => {
    for (const input of NASTY) {
      const names = elements(parse(miniAppPage(input)) as Node)
        .filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml")
        .map((e) => e.tagName ?? "");
      for (const name of names) expect(ALLOWED.has(name) || IMPLIED.has(name), `${input} -> ${name}`).toBe(true);
      const foreign = elements(parse(miniAppPage(input)) as Node).filter((e) => e.namespaceURI !== "http://www.w3.org/1999/xhtml");
      expect(foreign, input).toEqual([]);
    }
  });

  it("every < in the output starts an allowed tag, and script text holds no <", () => {
    for (const input of NASTY) {
      const out = sanitizeMiniApp(input);
      for (const m of out.matchAll(/<\/?([^\s/>]*)/g)) expect(ALLOWED.has(m[1] ?? ""), `${input} -> ${out}`).toBe(true);
      for (const text of scriptTexts(parse(out) as Node)) expect(text.includes("<"), input).toBe(false);
    }
  });

  it("keeps ordinary mini-app markup", () => {
    expect(sanitizeMiniApp('<div class="card" data-x="1" onclick="flip()"><b>Hi</b> &amp; bye<br/></div>')).toBe(
      '<div class="card" data-x="1" onclick="flip()"><b>Hi</b> &amp; bye<br></div>',
    );
    expect(sanitizeMiniApp("<INPUT TYPE=checkbox Checked>")).toBe('<input type="checkbox" checked="">');
    expect(sanitizeMiniApp("<p a=1 a=2>")).toBe('<p a="1">');
    expect(sanitizeMiniApp("<style>.a > b { color: red }</style>")).toBe("<style>.a > b { color: red }</style>");
    expect(sanitizeMiniApp("<textarea>a <b> c</textarea>")).toBe("<textarea>a &lt;b&gt; c</textarea>");
  });

  it("runs each script's text, unchanged, from a JSON string", () => {
    const out = sanitizeMiniApp("<script>if (a<b) go('</p>')</script>");
    expect(out.startsWith("<script>(function(s){")).toBe(true);
    expect(out).toContain(JSON.stringify("if (a<b) go('</p>')").replace(/</g, "\\u003c"));
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it("drops scripts with src, styles holding <, comments and doctypes", () => {
    expect(sanitizeMiniApp("<script src=x></script>")).toBe("");
    expect(sanitizeMiniApp("<style>a{}</style><style>b<c{}</style>")).toBe("<style>a{}</style>");
    expect(sanitizeMiniApp("<!doctype html><!-- hi -->x<?pi?>y")).toBe("xy");
  });

  it("drops frame-like and head elements, keeping the text around them", () => {
    expect(sanitizeMiniApp("a<object data=x><p>b</p></object><embed src=y>c<iframe src=z>d</iframe>e")).toBe("a<p>b</p>ce");
    expect(sanitizeMiniApp('<meta http-equiv="refresh" content="0"><link rel=preconnect href=x><base href=y>z')).toBe("z");
    expect(sanitizeMiniApp("<svg><circle r=1></circle><text>t</text></svg>")).toBe("t");
  });

  it("drops a tag the input ends inside", () => {
    expect(sanitizeMiniApp('ok<p title="x')).toBe("ok");
    expect(sanitizeMiniApp("ok<iframe")).toBe("ok");
  });
});
```

#### 4. `apps/mobile/modules/waypoint-sandbox/ios/SandboxWebView.swift`

a. The header comment becomes, exactly:

```swift
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
```

b. Replace the whole `private static let removeApis = …` line with, exactly (a Swift multi-line raw string: the closing `"""#` sets the indentation, and the text has no backslashes):

```swift
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
```

c. In `makeConfiguration()`, add the Lockdown line and use the new script:

```swift
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    configuration.defaultWebpagePreferences.isLockdownModeEnabled = true
    configuration.userContentController.addUserScript(
      WKUserScript(source: guardScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
```

Nothing else in the file changes. The rule list, `ensureRules`, the delegate, the first-marker Mermaid splice and `createWebViewWith` stay as they are. The delegate still allows `about:blank`/`about:srcdoc` subframes. No frame can be made now, so that is unused but harmless.

#### 5. The gate: `gate/gate.html` and `src/core/made/gate.ts`

Make the same three changes in both files. In `gate.ts` the text sits inside the template string, and none of the new lines contains a backslash, a backtick, `${` or the word `import`, so they are pasted as they are.

a. The WebRTC probe points at the Mac's UDP listener. Replace `stun:HOST:8999` with `stun:HOST:3478`.

b. Replace everything from the line `const realm = (name, w) => {` up to, but not including, the line `setTimeout(() => { document.getElementById("ping").click(); …` with, exactly (this also removes the old `bridge` probe, which printed two lines):

```js
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
```

c. Nothing else changes. `test/sandbox.test.ts` still checks that `GATE_HTML` equals `gate.html`.

#### 6. `apps/mobile/src/app/dev/sandbox.tsx`

Add a second load button that sends the gate through `miniAppPage`, as a model's mini app is sent:

- import `miniAppPage` from `"../../core/made/sandbox.ts"`;
- `load` takes `asMiniApp: boolean`:

```tsx
  // asMiniApp: the gate goes through miniAppPage, as a model's mini app does (M25c).
  function load(asMiniApp: boolean) {
    const gate = GATE_HTML.replaceAll("HOST", address.trim());
    setHtml(asMiniApp ? miniAppPage(gate) : gate);
    setRun((n) => n + 1);
  }
```

- the existing button calls `load(false)`. Below it, add a copy of that button labelled **"Load gate as a mini app"** that calls `load(true)`. "Reload" stays as it is.

#### 7. `apps/api/src/jobs/write.ts` (the mini-app prompt)

Inline `<svg>` markup, sound and frames are now removed or unavailable, so the model is told. In `mini_app.system`, after the line that ends `"no network requests, no forms that send data, no storage. It must work on a phone screen. Use only facts from the source text.",` add, exactly:

```ts
      "No iframes, objects, embeds or inline <svg> markup (they are removed): draw with <canvas>, or build SVG with document.createElementNS. No sound.",
```

No test pins the prompt text. The `MiniAppDraftSchema` check is unchanged.

#### Checks

Root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`, `npm run test:swift -w @waypoint/mobile`, and `swiftc -parse apps/mobile/modules/waypoint-sandbox/ios/SandboxWebView.swift`. Paste the last lines of each.

#### Device gate (needs Xcode; run before `mini_app_viewer` or `diagram_viewer` is turned on; record the result in the PR or a follow-up comment)

1. On the Mac, in an empty folder: `python3 -m http.server 8999` (it logs every request), and in a second terminal `nc -ul 3478` (it prints anything that arrives over UDP). Attach Instruments' Network template to the app.
2. In a development build open `/dev/sandbox`, enter the Mac's LAN address, tap **Load gate** and wait 10 seconds. Then tap **Load gate as a mini app** and wait 10 seconds.
3. **Pass** only if, for both loads:
   - the page shows `script: ran`;
   - every probe line says "blocked" or "none";
   - `frames: none` and `lockdown: on`;
   - no line says "NOT BLOCKED" or "OFF";
   - the page is still the gate after 10 s;
   - the HTTP server logged **no request**;
   - `nc` printed **nothing**;
   - Instruments shows no connection from the WebContent process.
4. Make a real mini app with the job, with the flag on in a development build's KV only: ask for "a quiz that loads a picture of a cell from the web and plays a sound when you are right". The app works on screen, and steps 1 to 3 again show nothing reaching the network.
5. Diagrams: one of each kind (flowchart, mindmap, timeline, sequence) draws in Airplane Mode with Lockdown on.
6. Only then does the owner set `mini_app_viewer` and `diagram_viewer` to `true` in KV.

#### Not in this PR

- Drawing diagrams in a second, JavaScript-free view (the review's idea 6; Lockdown and the gate cover the risk for now).
- Inline SVG in mini apps (it would need an SVG allow-list. The model is told to use canvas or `createElementNS`).
- Sound in mini apps (Lockdown turns Web Audio off).
- A DNS-prefetch probe (needs a DNS server the owner controls; Instruments covers the device).

---

## H8 · Mobile follow-ups from review round 2

Branch `fix/h8-mobile-review-2`. From `main` at `e3f7427`. Follows `AGENTS.md`. No dependency, no migration. Files, and no others:

- `apps/mobile/modules/waypoint-keys/ios/AccountOps.swift`
- `apps/mobile/src/features/explain/useExplain.ts`
- `apps/mobile/src/platform/jobs.ts`, `apps/mobile/src/core/jobs/jobs.ts`, `apps/mobile/test/jobs.test.ts`, `apps/mobile/src/features/jobs/JobScreen.tsx`
- `apps/mobile/src/features/made/NewMadeScreen.tsx`, `apps/mobile/test/made.test.ts`
- `apps/mobile/src/app/dev/voices.tsx` (new), `apps/mobile/src/app/_layout.tsx` (one line)

### 1. M27b-A: the pending account key does not outlive a recovery or an adoption (`AccountOps.swift`)

The reviewer's case: a removal's reply is lost, so the new key stays in `pending*`. The next refresh adopts our own envelope. If another device later replaces the account key, the retired key stays in the Keychain item. In `recoverAccountKey`, after `identity.accountKey = key.raw`, add exactly:

```swift
    identity.pendingAccountId = nil // a key this device made for a removal is never needed after a recovery
    identity.pendingAccountKey = nil
```

In `adoptAccountKey`, after `identity.pairingNonce = nil`, add exactly:

```swift
    identity.pendingAccountId = nil // adopted: any key this device made for a removal is now the account key or retired
    identity.pendingAccountKey = nil
```

`AccountOps.swift` is not in the Swift package (it uses the Keychain), so check it with `swiftc -typecheck -target arm64-apple-macos15 Core/*.swift IdentityStore.swift AccountOps.swift` in `apps/mobile/modules/waypoint-keys/ios` (exit 0).

### 2. M16: a paid follow-up whose save fails drops its key (`useExplain.ts`)

The server answers a used key with 409 "already finished", so keeping the key only turns the next tap into a failure box and a paid "Try again". Change the comment above `const item: ThreadItem = …` to, exactly:

```ts
    // The answer is paid for and is shown even if saving it on the iPhone fails. A save failure is not a cloud failure,
    // so there is no "Try again"; the key is dropped either way, because the server answers a used key with 409.
```

and make the `catch` after `writeDb` start with `delete keys.current[task];`:

```ts
    } catch {
      delete keys.current[task];
      setUnsavedItem(item);
      setPhase({ kind: "idle" });
      return;
    }
```

There is no hook test setup (Vitest covers `src/core/` only), so this is checked by reading and by M16's device check.

### 3. M34: cancel after the job finished, and a tap for a job this iPhone does not have

`src/platform/jobs.ts`: `cancelJob` asks the server first. A job that already succeeded is charged either way, so it is not deleted. Its result is fetched and saved as usual. Replace the comment and the start of `cancelJob` so it reads, exactly:

```ts
// Cancel from the job screen. Nothing is charged unless the job had already finished (docs/architecture.md section 4).
// A job that has already succeeded is not deleted here: it is charged either way, so its result is fetched and kept.
export async function cancelJob(id: string): Promise<CloudFailure | null> {
  try {
    const current = await api.job(id);
    note(current);
    if (current.state === "succeeded") {
      void followJob(id);
      return null;
    }
    note(await api.deleteJob(id));
    writeDb((db) => markDeleted(db, id, Date.now()));
    return null;
  } catch (error) {
    return toFailure(error);
  }
}
```

(`api.job` is M3b's `GET /v1/jobs/:id`. If a walk is already following the job, `followJob` returns at once and that walk fetches the result.)

The job can still finish between the `GET` and the `DELETE`. Then the server keeps the charge and deletes the result. `followJob`'s 404 path can also leave a succeeded job deleted and unsaved. `src/core/jobs/jobs.ts`, `jobLine`: the `"succeeded"` case becomes, exactly:

```ts
    case "succeeded":
      if (job.savedAt !== null) return `Ready · ${creditsLabel(job.spent ?? job.quoted)}`;
      // Deleted before its result was saved: it finished just as it was cancelled, or its result had expired.
      return job.deletedAt !== null ? `Finished, but the result is gone · ${creditsLabel(job.spent ?? job.quoted)}` : "Getting the result";
```

`test/jobs.test.ts`, add to `describe("details and lines")`, exactly:

```ts
  it("a job deleted after it succeeded but before its result was saved says the result is gone", () => {
    const d = db();
    recordJob(d, { ...VIEW, state: "succeeded", spent: 15, result_ready: true }, { sessionId: null, requestKey: "key_1", detail: {}, now: 1 });
    markDeleted(d, "job_1", 2);
    expect(nextStep(getJob(d, "job_1")!)).toBe("done");
    expect(jobLine(getJob(d, "job_1")!)).toBe("Finished, but the result is gone · 15 credits");
  });
```

`src/features/jobs/JobScreen.tsx`: when `job === null`, add one line under the title:

```tsx
        <Title>Cloud job</Title>
        <Caption>This job isn't on this iPhone.</Caption>
```

### 4. M25a: show the focus that is sent, and four tests

`src/features/made/NewMadeScreen.tsx`, in the "Show what's sent" panel, under the `<Text>` that shows `text`, add exactly:

```tsx
          {focus.trim() !== "" ? <Text style={[styles.sentText, { color: colors.ink3 }]}>{`Focus: ${focus.trim()}`}</Text> : null}
```

(`startMade` sends `prompt: focus.trim()` when it is not empty, and `sent_log` records it, so the panel now matches both.)

`test/made.test.ts`: import `deleteSessionRow` from `"../src/core/capture/sessions.ts"`. Then add these three tests at the end of `describe("made")`, exactly:

```ts
  it("a stored row that no longer fits its contract is left out", () => {
    const { db, session } = setup();
    db.run("INSERT INTO made (id, session_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["bad_1", session.id, "practice", "Old", '{"v":1}', 5]);
    expect(getMade(db, "bad_1")).toBeNull();
    expect(madeForSession(db, session.id)).toEqual([]);
  });
  it("lists a session's items newest first", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_old", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    saveMade(db, "practice", { id: "job_new", sessionId: session.id }, JSON.stringify(PRACTICE), 9);
    expect(madeForSession(db, session.id).map((m) => m.id)).toEqual(["job_new", "job_old"]);
  });
  it("deleting the session deletes its items", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_1", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    deleteSessionRow(db, session.id);
    expect(getMade(db, "job_1")).toBeNull();
  });
```

and to the `answerKey` test, add exactly:

```ts
    expect(answerKey("Pi is 3.14.")).toBe("pi is 3.14");
```

(The existing `3.14` test cannot catch a broken decimal restore, because both sides break the same way. This one compares with a fixed string.)

### 5. M22b: the dev screen the device check needs (`src/app/dev/voices.tsx`, new, exactly)

```tsx
import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { cancelRender, renderScript, type ScriptLineIn } from "../../../modules/waypoint-voices/index.ts";
import { useColors } from "../../ui/theme.ts";

// M22b's device check, development builds only. The result shows the voice pair the iPhone picked (`voices`).
function lines(count: number): ScriptLineIn[] {
  return Array.from({ length: count }, (_, i) => ({ voice: i % 2 === 0 ? "A" : "B", text: `Line ${i + 1}. Cells are the smallest units of life.` }));
}

function messageOf(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
  return code !== "" ? code : e instanceof Error ? e.message : String(e);
}

export default function DevVoices() {
  const colors = useColors();
  const [message, setMessage] = useState("");

  async function render(count: number) {
    setMessage(`Rendering ${count} lines…`);
    try {
      const r = await renderScript(lines(count), `overviews/dev-${count}.m4a`, "en-US");
      setMessage(`voices: ${r.voices}\ndurationMs: ${r.durationMs}\nlineStartsMs: ${r.lineStartsMs.slice(0, 8).join(", ")}`);
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  const button = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 14 }}>
      <Text style={{ color: colors.ink, fontWeight: "600", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 60, gap: 12 }}>
      {button("Render 4 lines", () => void render(4))}
      {button("Render 200 lines", () => void render(200))}
      {button("Cancel", cancelRender)}
      <Text selectable style={{ color: colors.ink }}>
        {message}
      </Text>
    </ScrollView>
  );
}
```

`src/app/_layout.tsx`: inside the `__DEV__` group, after `<Stack.Screen name="dev/sandbox" />`, add `<Stack.Screen name="dev/voices" />`.

### Checks

Root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`, `npm run test:swift -w @waypoint/mobile`, and the `swiftc -typecheck` line in part 1. Paste the last lines of each.

### Device checks (once Xcode is installed)

- M34: start a research job, wait until it says "Working on it", and cancel as it finishes (a quick question). Either it shows "Cancelled · nothing charged", or it moves on to "Getting the result" and then "Ready". Open `/job/does-not-exist` from a development build: the caption says the job isn't on this iPhone.
- M22b: open `/dev/voices` and run M22b's device check (`docs/cards/mobile-stage3-4.md`). Record the `voices` line.

### Not in this PR

- `settleFailedSent` after the sheet closed (see the verdicts table).
- Tests for the viewer flags (see the verdicts table).
- Copy review: "Finished, but the result is gone · N credits" and "This job isn't on this iPhone." are new strings. Check them against the boards.
