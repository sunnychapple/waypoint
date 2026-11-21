import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The share screens render with React Native, which vitest does not run, so these check the source: the copy the
// card asked for is there, and the unreachable /shared/new route is gone.
const SRC = resolve(__dirname, "../src");
const src = (path: string) => readFileSync(resolve(SRC, path), "utf8");

describe("unreachable /shared/new", () => {
  it("has no route file, no feature screen and no layout line", () => {
    expect(existsSync(resolve(SRC, "app/shared/new.tsx"))).toBe(false);
    expect(existsSync(resolve(SRC, "features/share/NewSharedSpaceScreen.tsx"))).toBe(false);
    expect(src("app/_layout.tsx")).not.toContain("shared/new");
  });
});

describe("share screens", () => {
  it("marks the chosen expiry with a checkmark", () => {
    expect(src("features/share/ShareSessionScreen.tsx")).toContain("right={expiry === choice.value ? <Check /> : null}");
  });

  it("explains each invite role in one line", () => {
    const invite = src("features/share/InviteScreen.tsx");
    expect(invite).toContain('explain: "Can add and change notes"');
    expect(invite).toContain('explain: "Can only look"');
  });

  it("shows an invite sent state only after the share sheet completes", () => {
    const invite = src("features/share/InviteScreen.tsx");
    expect(invite).toContain('<Title>Invite sent</Title>');
    expect(invite).toContain("When they join, open NotePath so they can see the notes.");
    expect(invite).toContain("if (result.action === Share.sharedAction) setSent(true);");
  });

  it("offers the offline message for server-only actions", () => {
    const offline = "You're offline. Connect to the internet and try again.";
    expect(src("features/share/InviteScreen.tsx")).toContain(offline);
    expect(src("features/share/ShareSessionScreen.tsx")).toContain(offline);
    expect(src("features/capture/NewSpaceScreen.tsx")).toContain(offline);
  });
});
