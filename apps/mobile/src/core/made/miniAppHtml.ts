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
