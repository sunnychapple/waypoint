import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("recording Live Activity", () => {
  // iOS hands the app's activity to the widget by the attributes' type name and decodes the state from the same JSON.
  it("the app and the widget use the same RecordingActivity.swift", () => {
    const app = readFileSync(join(MOBILE, "modules/waypoint-audio/ios/Core/RecordingActivity.swift"), "utf8");
    const widget = readFileSync(join(MOBILE, "targets/recording/RecordingActivity.swift"), "utf8");
    expect(widget).toBe(app);
  });

  it("the app says it has Live Activities and builds the widget target", () => {
    const config = JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")) as {
      expo: { ios: { infoPlist: Record<string, unknown> }; plugins: unknown[] };
    };
    expect(config.expo.ios.infoPlist["NSSupportsLiveActivities"]).toBe(true);
    expect(config.expo.plugins).toContain("@bacons/apple-targets");
  });
});
