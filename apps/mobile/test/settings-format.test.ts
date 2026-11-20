import { describe, expect, it } from "vitest";
import { bytesLabel, percentLabel, versionLabel } from "../src/core/settings/format.ts";

describe("settings format", () => {
  it("bytesLabel and percentLabel give the boundary values", () => {
    expect(bytesLabel(0)).toBe("0 KB");
    expect(bytesLabel(999)).toBe("1 KB");
    expect(bytesLabel(999_499)).toBe("999 KB");
    expect(bytesLabel(999_500)).toBe("1 MB");
    expect(bytesLabel(340_000_000)).toBe("340 MB");
    expect(bytesLabel(999_499_999)).toBe("999 MB");
    expect(bytesLabel(999_500_000)).toBe("1.0 GB");
    expect(bytesLabel(1_200_000_000)).toBe("1.2 GB");
    expect(percentLabel(0, 0)).toBe("100%");
    expect(percentLabel(0, 100)).toBe("0%");
    expect(percentLabel(98, 100)).toBe("98%");
    expect(percentLabel(999, 1_000)).toBe("99%");
    expect(percentLabel(100, 100)).toBe("100%");
  });

  it("versionLabel leaves out a missing build number", () => {
    expect(versionLabel("1.0.0", "42")).toBe("Version 1.0.0 (42)");
    expect(versionLabel("1.0.0", null)).toBe("Version 1.0.0");
    expect(versionLabel("1.0.0", "")).toBe("Version 1.0.0");
  });
});
