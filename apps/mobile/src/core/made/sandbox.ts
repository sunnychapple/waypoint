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

// A Mermaid diagram page. The native view inserts Mermaid's own script where MERMAID_SCRIPT is.
export const MERMAID_SCRIPT = "/*MERMAID*/";
export function diagramPage(source: string, dark: boolean): string {
  return (
    `${HEAD}<style>body{margin:0;padding:16px;background:${dark ? "#000" : "#fff"}}svg{max-width:100%;height:auto}</style></head><body><div id="d"></div>` +
    `<script>${MERMAID_SCRIPT}</script><script>` +
    `mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:${dark ? '"dark"' : '"default"'}});` +
    `mermaid.render("g",${scriptJson(source)}).then(function(r){document.getElementById("d").innerHTML=r.svg;},function(){document.getElementById("d").textContent="This diagram couldn't be drawn.";});` +
    `</script></body></html>`
  );
}
