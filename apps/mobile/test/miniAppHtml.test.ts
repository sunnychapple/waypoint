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
