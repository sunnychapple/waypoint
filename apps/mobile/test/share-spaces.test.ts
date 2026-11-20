import { describe, expect, it } from "vitest";
import {
  canInvite,
  canLeave,
  canRemove,
  inviteEnds,
  isFallbackSpaceName,
  memberLabels,
  safetyCode,
  type Member,
} from "../src/core/share/spaces.ts";

const member = (user_id: string, role: Member["role"], starts_at: number): Member => ({
  user_id,
  role,
  starts_at,
  ends_at: null,
  history_from: 0,
});

const DAY = 24 * 60 * 60 * 1000;

describe("memberLabels", () => {
  it("labels this person You, other owners Owner, and the others Member n by join order", () => {
    const members = [
      member("usr_late", "viewer", 300),
      member("usr_me", "owner", 100),
      member("usr_early", "editor", 200),
      member("usr_owner2", "owner", 150),
    ];
    const labels = memberLabels(members, "usr_me");
    expect(labels.get("usr_me")).toBe("You");
    expect(labels.get("usr_owner2")).toBe("Owner");
    expect(labels.get("usr_early")).toBe("Member 1");
    expect(labels.get("usr_late")).toBe("Member 2");
  });

  it("labels the only member of a space You", () => {
    const labels = memberLabels([member("usr_me", "owner", 100)], "usr_me");
    expect(labels.get("usr_me")).toBe("You");
    expect(labels.size).toBe(1);
  });

  it("numbers members from 1 even when the owner joined first", () => {
    const labels = memberLabels([member("usr_owner", "owner", 1), member("usr_a", "viewer", 2)], "usr_owner");
    expect(labels.get("usr_a")).toBe("Member 1");
  });
});

describe("inviteEnds", () => {
  it("gives no end date for No end", () => {
    expect(inviteEnds("none", 1_000)).toBeNull();
  });

  it("ends 7 days after now for 1 week", () => {
    expect(inviteEnds("week", 1_000)).toBe(1_000 + 7 * DAY);
  });

  it("ends 30 days after now for 1 month", () => {
    expect(inviteEnds("month", 1_000)).toBe(1_000 + 30 * DAY);
  });

  it("ends 90 days after now for 3 months", () => {
    expect(inviteEnds("quarter", 1_000)).toBe(1_000 + 90 * DAY);
  });

  it("never ends an owner invite, whatever the choice", () => {
    expect(inviteEnds("week", 1_000, "owner")).toBeNull();
    expect(inviteEnds("quarter", 1_000, "owner")).toBeNull();
  });

  it("still ends an editor or viewer invite", () => {
    expect(inviteEnds("week", 1_000, "editor")).toBe(1_000 + 7 * DAY);
  });
});

describe("isFallbackSpaceName", () => {
  it("matches Shared space and its numbered forms", () => {
    expect(isFallbackSpaceName("Shared space")).toBe(true);
    expect(isFallbackSpaceName("Shared space 2")).toBe(true);
    expect(isFallbackSpaceName("Shared space 12")).toBe(true);
  });

  it("does not match a name the person chose", () => {
    expect(isFallbackSpaceName("Family")).toBe(false);
    expect(isFallbackSpaceName("Shared space notes")).toBe(false);
    expect(isFallbackSpaceName("")).toBe(false);
  });
});

describe("canLeave", () => {
  it("lets the last owner not leave", () => {
    expect(canLeave([member("usr_me", "owner", 1), member("usr_a", "viewer", 2)], "usr_me")).toBe(false);
  });

  it("lets an owner leave when another owner remains", () => {
    expect(canLeave([member("usr_me", "owner", 1), member("usr_o2", "owner", 2)], "usr_me")).toBe(true);
  });

  it("lets an editor or viewer leave", () => {
    expect(canLeave([member("usr_me", "editor", 2), member("usr_o", "owner", 1)], "usr_me")).toBe(true);
  });
});

describe("safetyCode", () => {
  it("is the first 12 characters of the hash in groups of 4", () => {
    expect(safetyCode("abcdef0123456789" + "f".repeat(48))).toBe("abcd ef01 2345");
  });
});

describe("canInvite", () => {
  it("lets an owner invite", () => {
    expect(canInvite("owner")).toBe(true);
  });

  it("does not let an editor invite", () => {
    expect(canInvite("editor")).toBe(false);
  });

  it("does not let a viewer invite", () => {
    expect(canInvite("viewer")).toBe(false);
  });
});

describe("canRemove", () => {
  it("lets an owner remove an editor", () => {
    expect(canRemove("owner", "editor")).toBe(true);
  });

  it("does not let an owner remove another owner", () => {
    expect(canRemove("owner", "owner")).toBe(false);
  });

  it("does not let an editor remove anyone", () => {
    expect(canRemove("editor", "viewer")).toBe(false);
  });

  it("does not let a viewer remove anyone", () => {
    expect(canRemove("viewer", "viewer")).toBe(false);
  });
});
