// Reads server-sent events from a response body (the API writes them with hono's streamSSE, "\n" line endings):
// blocks separated by a blank line, each with "event:" and "data:" lines; several data lines join with "\n".
// Comment lines (":") and other fields are ignored. onEvent returning false stops reading.
export type SseEvent = { event: string; data: string };

export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = done ? "" : (blocks.pop() ?? "");
      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed !== null && !onEvent(parsed)) return;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}
