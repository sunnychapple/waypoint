import { describe, expect, it } from "vitest";
import { toFtsQuery } from "../src/core/search/fts.ts";

describe("toFtsQuery", () => {
  it("quotes each word and adds a prefix star to the last one", () => {
    expect(toFtsQuery("deadweight loss")).toBe('"deadweight" "loss"*');
  });

  it("keeps quotes, stars, minus signs, NEAR and quote marks out of the query as syntax", () => {
    expect(toFtsQuery('He said "NEAR" -x*')).toBe('"He" "said" "NEAR" "x"*');
  });

  it("returns null when the input has no letters or digits", () => {
    expect(toFtsQuery("!!!")).toBeNull();
  });
});
