import { describe, expect, it } from "vitest";
import { readSse, type SseEvent } from "../src/index.ts";

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
}
const enc = (s: string) => new TextEncoder().encode(s);

describe("readSse", () => {
  it("joins chunks, including a split UTF-8 character", async () => {
    const bytes = enc('event: delta\ndata: {"text":"café"}\n\n');
    const at = bytes.indexOf(0xc3) + 1;
    const got: SseEvent[] = [];
    await readSse(bodyOf([bytes.slice(0, 5), bytes.slice(5, at), bytes.slice(at)]), (e) => { got.push(e); return true; });
    expect(got).toEqual([{ event: "delta", data: '{"text":"café"}' }]);
  });
  it("multi data lines, comments, ids, empty blocks, last block", async () => {
    const got: SseEvent[] = [];
    await readSse(bodyOf([enc(": hi\nid: 1\nevent: a\ndata: x\ndata: y\n\nevent: b\n\ndata: z")]), (e) => { got.push(e); return true; });
    expect(got).toEqual([{ event: "a", data: "x\ny" }, { event: "message", data: "z" }]);
  });
  it("stops when onEvent returns false", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc("data: 1\n\ndata: 2\n\n")); }, cancel() { cancelled = true; } });
    const got: string[] = [];
    await readSse(body, (e) => { got.push(e.data); return false; });
    expect(got).toEqual(["1"]);
    expect(cancelled).toBe(true);
  });
});
