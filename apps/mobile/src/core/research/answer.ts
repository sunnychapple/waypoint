// A research answer is Markdown that cites sources as [n] (PR 24). It is shown as plain text blocks: no HTML, no
// remote images (an image URL could carry the notes to someone else's server, hardening note for M19), and links
// only as text with their host.
export type Inline = { kind: "text"; text: string } | { kind: "cite"; n: number };
export type Block = { kind: "heading" | "paragraph" | "bullet"; parts: Inline[] };

function host(url: string): string {
  const match = /^https?:\/\/([^/?#\s]+)/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? "link";
}

// One line's inline Markdown: images become "(image: alt)", links "text (host)", emphasis marks are dropped, and
// [n] becomes a citation when n is one of the sources.
export function inlineParts(line: string, sources: ReadonlySet<number>): Inline[] {
  const text = line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() === "" ? "(image)" : `(image: ${alt.trim()})`))
    .replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, label: string, url: string) => `${label} (${host(url)})`)
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");
  const out: Inline[] = [];
  let rest = text;
  const cite = /\[(\d{1,3})\]/;
  for (let m = cite.exec(rest); m !== null; m = cite.exec(rest)) {
    const n = Number(m[1]);
    const before = rest.slice(0, m.index);
    if (sources.has(n)) {
      if (before !== "") out.push({ kind: "text", text: before });
      out.push({ kind: "cite", n });
    } else {
      out.push({ kind: "text", text: before + m[0] });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== "") out.push({ kind: "text", text: rest });
  // Join neighbouring text parts.
  return out.reduce<Inline[]>((acc, part) => {
    const last = acc[acc.length - 1];
    if (part.kind === "text" && last !== undefined && last.kind === "text") acc[acc.length - 1] = { kind: "text", text: last.text + part.text };
    else acc.push(part);
    return acc;
  }, []);
}

export function answerBlocks(markdown: string, sourceNumbers: number[]): Block[] {
  const sources = new Set(sourceNumbers);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", parts: inlineParts(paragraph.join(" "), sources) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("```") || /^[-*_]{3,}$/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", parts: inlineParts(heading[1] ?? "", sources) });
    } else if (bullet !== null) {
      flush();
      blocks.push({ kind: "bullet", parts: inlineParts(bullet[1] ?? "", sources) });
    } else {
      paragraph.push(line.replace(/^>\s?/, ""));
    }
  }
  flush();
  return blocks;
}

// Only http and https sources open, in the in-app browser.
export function openableUrl(url: string): string | null {
  return /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}
