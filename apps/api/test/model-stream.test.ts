import type { Queue } from "@cloudflare/workers-types";
import { describe, expect, test } from "vitest";
import { readModelStream, readUsage } from "../src/ai/stream.ts";
import { sendUsage, type UsageEvent, type UsageQueue } from "../src/usage.ts";

export const usageQueueFits: (queue: Queue<UsageEvent>) => UsageQueue = (queue) => queue;

// Each string becomes one chunk of the stream, in order.
function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function collector(): { texts: string[]; onText: (text: string) => Promise<void> } {
  const texts: string[] = [];
  return {
    texts,
    onText: async (text) => {
      texts.push(text);
    },
  };
}

const chat = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const USAGE_EVENT: UsageEvent = {
  v: 1,
  id: "explain:user-1:key-1",
  at: 1_800_000_000_000,
  user_id: "user-1",
  task: "explain",
  outcome: "ok",
  credits: 1,
  tier: "light",
  model: "@cf/example/model",
  retention: "standard",
  router: "ok",
  bytes_sent: 120,
  tokens_in: 10,
  tokens_out: 5,
};

describe("readModelStream", () => {
  test("passes on chat chunk text in order and counts its characters", async () => {
    const { texts, onText } = collector();
    const result = await readModelStream(sse([chat("Water "), chat("moves."), "data: [DONE]\n\n"]), onText);
    expect(texts).toEqual(["Water ", "moves."]);
    expect(result.chars).toBe(12);
  });

  test("reads the { response } reply shape the same way", async () => {
    const { texts, onText } = collector();
    const chunks = [
      `data: ${JSON.stringify({ response: "Water " })}\n\n`,
      `data: ${JSON.stringify({ response: "moves." })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const result = await readModelStream(sse(chunks), onText);
    expect(texts).toEqual(["Water ", "moves."]);
    expect(result.chars).toBe(12);
  });

  test("copies token counts from a usage object and leaves them null when there is none", async () => {
    const withUsage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 9 } })}\n\n`;
    const counted = await readModelStream(sse([withUsage, "data: [DONE]\n\n"]), collector().onText);
    expect(counted.tokens_in).toBe(120);
    expect(counted.tokens_out).toBe(9);

    const plain = await readModelStream(sse([chat("Hi"), "data: [DONE]\n\n"]), collector().onText);
    expect(plain.tokens_in).toBeNull();
    expect(plain.tokens_out).toBeNull();
  });

  test("reads one event split across two chunks in the middle of its JSON, once, whole", async () => {
    const { texts, onText } = collector();
    const line = chat("Osmosis is water moving.");
    const cut = Math.floor(line.length / 2);
    await readModelStream(sse([line.slice(0, cut), line.slice(cut), "data: [DONE]\n\n"]), onText);
    expect(texts).toEqual(["Osmosis is water moving."]);
  });

  test("accepts \\r\\n line endings", async () => {
    const { texts, onText } = collector();
    const crlf = `${chat("One").trimEnd()}\r\n\r\n${chat("Two").trimEnd()}\r\n\r\ndata: [DONE]\r\n\r\n`;
    await readModelStream(sse([crlf]), onText);
    expect(texts).toEqual(["One", "Two"]);
  });

  test("passes on nothing for a chunk that has only reasoning_content", async () => {
    const { texts, onText } = collector();
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\n`;
    const result = await readModelStream(sse([reasoning, "data: [DONE]\n\n"]), onText);
    expect(texts).toEqual([]);
    expect(result.chars).toBe(0);
  });

  test("ignores lines after data: [DONE]", async () => {
    const { texts, onText } = collector();
    await readModelStream(sse(["data: [DONE]\n\n", chat("late")]), onText);
    expect(texts).toEqual([]);
  });

  test("returns normally when the stream ends without [DONE], including a last line with no newline", async () => {
    const { texts, onText } = collector();
    const result = await readModelStream(sse([chat("Water "), `data: ${JSON.stringify({ response: "moves." })}`]), onText);
    expect(texts).toEqual(["Water ", "moves."]);
    expect(result.chars).toBe(12);
  });

  test("throws when a data line is not JSON", async () => {
    await expect(readModelStream(sse(["data: {bad json\n\n"]), collector().onText)).rejects.toThrow();
  });

  test("throws when the stream errors, after passing on the first chunk", async () => {
    const { texts, onText } = collector();
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode(chat("Water ")));
        else controller.error(new Error("x"));
      },
    });
    await expect(readModelStream(failing, onText)).rejects.toThrow("x");
    expect(texts).toEqual(["Water "]);
  });

  test("does not pass on empty content strings or count them", async () => {
    const { texts, onText } = collector();
    const result = await readModelStream(sse([chat(""), chat("Hi"), "data: [DONE]\n\n"]), onText);
    expect(texts).toEqual(["Hi"]);
    expect(result.chars).toBe(2);
  });
});

describe("readUsage", () => {
  test("leaves tokens_in null when prompt_tokens is not an integer", () => {
    const result = { tokens_in: null as number | null, tokens_out: null as number | null };
    readUsage({ usage: { prompt_tokens: 1.5 } }, result);
    expect(result.tokens_in).toBeNull();
  });
});

describe("sendUsage", () => {
  test("resolves when the queue throws, and sends a working event once, unchanged", async () => {
    await expect(
      sendUsage(
        {
          send: async () => {
            throw new Error("queue down");
          },
        },
        USAGE_EVENT,
      ),
    ).resolves.toBeUndefined();

    const sent: UsageEvent[] = [];
    await sendUsage(
      {
        send: async (event) => {
          sent.push(event);
        },
      },
      USAGE_EVENT,
    );
    expect(sent).toEqual([USAGE_EVENT]);
  });
});
