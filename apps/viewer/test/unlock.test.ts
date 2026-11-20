import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SharedItemSchema } from "@waypoint/contracts";
import { context as refContext, importContentKey, lockContent, toBase64Url } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { checkSharedItem } from "../src/item.ts";
import { context, fromBase64Url, importLinkKey, keyFromFragment, linkIdFromPath, unlock } from "../src/unlock.ts";

const vectors = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../packages/crypto/test/vectors/waypoint-v1.json"), "utf8"));
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("unlock", () => {
  it("opens the published content vector", async () => {
    const c = vectors.content;
    const key = await importLinkKey(hex(c.key));
    const out = await unlock(key, context(c.context_label, ...c.context_fields), fromBase64Url(c.locked)!, c.key_version);
    expect(new TextDecoder().decode(out!)).toBe(c.plaintext_utf8);
    expect(await unlock(key, context(c.context_label, ...c.context_fields), fromBase64Url(c.locked)!, 0)).toBeNull();
  });
  it("matches packages/crypto: context, and a link locked there", async () => {
    expect(context("link", "lnk_abcdefghijklmnopqrstuv")).toEqual(refContext("link", "lnk_abcdefghijklmnopqrstuv"));
    const raw = new Uint8Array(32).fill(5);
    const locked = await lockContent(await importContentKey(raw), 0, refContext("link", "L".repeat(22)), new TextEncoder().encode("hi"), new Uint8Array(12));
    const key = await importLinkKey(raw);
    expect(new TextDecoder().decode((await unlock(key, context("link", "L".repeat(22)), new Uint8Array(locked)))!)).toBe("hi");
    expect(await unlock(key, context("link", "M".repeat(22)), new Uint8Array(locked))).toBeNull();
    expect(await unlock(await importLinkKey(new Uint8Array(32)), context("link", "L".repeat(22)), new Uint8Array(locked))).toBeNull();
  });
  it("reads the fragment and the path strictly", () => {
    const k = toBase64Url(new Uint8Array(32).fill(1));
    expect(keyFromFragment(`#k=${k}`)).toEqual(new Uint8Array(32).fill(1));
    expect(keyFromFragment(`#k=${k}x`)).toBeNull();
    expect(keyFromFragment(`#k=${k.slice(0, -1)}B`)).toBeNull(); // not canonical
    expect(keyFromFragment("")).toBeNull();
    expect(linkIdFromPath(`/l/${"a".repeat(22)}`)).toBe("a".repeat(22));
    expect(linkIdFromPath("/l/short")).toBeNull();
  });
});

describe("checkSharedItem agrees with SharedItemSchema", () => {
  const good = { v: 1, kind: "session", title: "Biology", created_at: 5, transcript: [{ t: 0, text: "cells" }], pages: [{ text: "p" }] };
  const cases: unknown[] = [good, { ...good, extra: 1 }, { ...good, v: 2 }, { ...good, title: "" }, { ...good, transcript: [{ t: -1, text: "" }] }, { ...good, pages: [{ text: "x", y: 1 }] }, null, [], "x"];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, value) => {
    expect(checkSharedItem(value) !== null).toBe(SharedItemSchema.safeParse(value).success);
  });
});
