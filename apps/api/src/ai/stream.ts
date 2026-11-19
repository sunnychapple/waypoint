export type StreamResult = { chars: number; tokens_in: number | null; tokens_out: number | null };

// Reads a Workers AI streamed reply (server-sent events, "data: <json>" lines, ending with
// "data: [DONE]") and calls onText with each piece of answer text, in order. Both reply shapes are
// read: { choices: [{ delta: { content } }] } and { response }. Reasoning text is never passed on.
// Throws if the stream fails or a data line is not JSON. The text itself is not kept.
export async function readModelStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => Promise<void>,
): Promise<StreamResult> {
  const result: StreamResult = { chars: 0, tokens_in: null, tokens_out: null };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const handleLine = async (line: string): Promise<void> => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "") return;
    if (payload === "[DONE]") {
      finished = true;
      return;
    }
    const chunk: unknown = JSON.parse(payload);
    const text = deltaText(chunk);
    if (text !== null && text !== "") {
      result.chars += text.length;
      await onText(text);
    }
    readUsage(chunk, result);
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line.replace(/\r$/, ""));
        if (finished) break;
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer !== "") await handleLine(buffer.replace(/\r$/, ""));
    }
  } finally {
    if (finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return result;
}

function deltaText(chunk: unknown): string | null {
  if (typeof chunk !== "object" || chunk === null) return null;
  if ("choices" in chunk && Array.isArray(chunk.choices)) {
    const first: unknown = chunk.choices[0];
    if (typeof first === "object" && first !== null && "delta" in first) {
      const delta: unknown = first.delta;
      if (typeof delta === "object" && delta !== null && "content" in delta && typeof delta.content === "string") {
        return delta.content;
      }
    }
    return null;
  }
  if ("response" in chunk && typeof chunk.response === "string") return chunk.response;
  return null;
}

// Copies the token counts from a reply or stream chunk that has a usage object.
export function readUsage(chunk: unknown, result: { tokens_in: number | null; tokens_out: number | null }): void {
  if (typeof chunk !== "object" || chunk === null || !("usage" in chunk)) return;
  const usage: unknown = chunk.usage;
  if (typeof usage !== "object" || usage === null) return;
  if ("prompt_tokens" in usage && Number.isSafeInteger(usage.prompt_tokens)) result.tokens_in = Number(usage.prompt_tokens);
  if ("completion_tokens" in usage && Number.isSafeInteger(usage.completion_tokens)) result.tokens_out = Number(usage.completion_tokens);
}
