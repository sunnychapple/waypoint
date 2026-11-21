import { describe, expect, it } from "vitest";
import { accountFiles, deleteAccountFailure, isDeleteConfirmation, LEGACY_DB_NAME } from "../src/core/db/users.ts";

describe("accountFiles", () => {
  it("names the person's database, its write-ahead log and journals, and their sessions", () => {
    const files = accountFiles({
      clerkUserId: "user_2abc",
      sessionIds: ["7f1c2d3e-0000-4000-8000-000000000001"],
      overviewFiles: ["overviews/9a8b7c6d-0000-4000-8000-000000000002.m4a"],
    });
    expect(files.files).toEqual([
      "SQLite/waypoint-user_2abc.db",
      "SQLite/waypoint-user_2abc.db-wal",
      "SQLite/waypoint-user_2abc.db-shm",
      "SQLite/waypoint-user_2abc.db-journal",
      "overviews/9a8b7c6d-0000-4000-8000-000000000002.m4a",
    ]);
    expect(files.sessionIds).toEqual(["7f1c2d3e-0000-4000-8000-000000000001"]);
  });

  it("never names the old shared database or another person's database", () => {
    const { files } = accountFiles({ clerkUserId: "user_a", sessionIds: [], overviewFiles: [] });
    expect(files.some((file) => file.includes(LEGACY_DB_NAME))).toBe(false);
    expect(files.some((file) => file.includes("user_b"))).toBe(false);
    expect(files.every((file) => file.includes("waypoint-user_a.db"))).toBe(true);
  });

  it("refuses a Clerk id that could reach outside the database folder", () => {
    expect(() => accountFiles({ clerkUserId: "../user_a", sessionIds: [], overviewFiles: [] })).toThrow("not a Clerk user id");
  });

  it("drops session ids and overview files that are not plain names", () => {
    const files = accountFiles({
      clerkUserId: "user_a",
      sessionIds: ["ok-id", "../other", "sessions/x", ""],
      overviewFiles: ["overviews/../../x.m4a", "/etc/passwd", "overviews/ok.m4a.exe", "overviews/ok.m4a"],
    });
    expect(files.sessionIds).toEqual(["ok-id"]);
    expect(files.files.filter((file) => file.startsWith("overviews/"))).toEqual(["overviews/ok.m4a"]);
  });

  it("names a video overview's mp4 as well as audio", () => {
    const { files } = accountFiles({ clerkUserId: "user_a", sessionIds: [], overviewFiles: ["overviews/abc-1.mp4", "overviews/abc-1.mov"] });
    expect(files).toContain("overviews/abc-1.mp4");
    expect(files).not.toContain("overviews/abc-1.mov");
  });

  it("names nothing else when the person has no notes yet", () => {
    expect(accountFiles({ clerkUserId: "user_a", sessionIds: [], overviewFiles: [] }).sessionIds).toEqual([]);
  });
});

describe("deleteAccountFailure", () => {
  it("is offline when Clerk reports a network error, or the request itself failed", () => {
    expect(deleteAccountFailure({ code: "network_error", message: "x" })).toBe("offline");
    expect(deleteAccountFailure(new TypeError("Network request failed"))).toBe("offline");
    expect(deleteAccountFailure({ code: "clerk_offline" })).toBe("offline");
  });

  it("asks the person to sign in again when Clerk wants a fresh verification", () => {
    expect(deleteAccountFailure({ errors: [{ code: "session_reverification_required" }] })).toBe("reverify");
    expect(deleteAccountFailure({ code: "reverification_required" })).toBe("reverify");
  });

  it("is failed for anything else, including nothing at all", () => {
    expect(deleteAccountFailure({ errors: [{ code: "form_param_unknown" }] })).toBe("failed");
    expect(deleteAccountFailure(new Error("boom"))).toBe("failed");
    expect(deleteAccountFailure(undefined)).toBe("failed");
    expect(deleteAccountFailure("network")).toBe("failed");
  });
});

describe("isDeleteConfirmation", () => {
  it("accepts DELETE, ignoring spaces around it", () => {
    expect(isDeleteConfirmation("DELETE")).toBe(true);
    expect(isDeleteConfirmation("  DELETE ")).toBe(true);
  });

  it("refuses anything else, including lower case", () => {
    expect(isDeleteConfirmation("")).toBe(false);
    expect(isDeleteConfirmation("delete")).toBe(false);
    expect(isDeleteConfirmation("DELETE ME")).toBe(false);
  });
});
