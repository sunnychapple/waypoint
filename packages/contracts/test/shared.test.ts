import { describe, expect, it } from "vitest";
import { SharedItemSchema } from "../src/index.ts";

const ITEM = { v: 1, kind: "session", title: "Biology", created_at: 1, transcript: [{ t: 0, text: "Cells divide." }], pages: [{ text: "Page one" }] };

describe("SharedItemSchema", () => {
  it("accepts a session item", () => {
    expect(SharedItemSchema.parse(ITEM)).toEqual(ITEM);
  });
  it("refuses extra keys, another version, an empty title and negative times", () => {
    expect(SharedItemSchema.safeParse({ ...ITEM, notes: "x" }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, v: 2 }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, title: "" }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, transcript: [{ t: -1, text: "x" }] }).success).toBe(false);
  });
});
