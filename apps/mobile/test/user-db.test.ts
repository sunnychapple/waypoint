import { describe, expect, it } from "vitest";
import { clerkIdsIn, LEGACY_DB_NAME, legacyIsTheirs, notesStep, userDbName } from "../src/core/db/users.ts";

describe("userDbName", () => {
  it("names a person's database after their Clerk user id", () => {
    expect(userDbName("user_2abcDEF123")).toBe("waypoint-user_2abcDEF123.db");
  });

  it("is never the old shared name", () => {
    expect(userDbName("user_1")).not.toBe(LEGACY_DB_NAME);
  });

  it("refuses an empty id, a path, a dot or an id longer than 64 characters", () => {
    for (const bad of ["", "../user_1", "user/1", "user.1", "a".repeat(65)]) {
      expect(() => userDbName(bad)).toThrow("not a Clerk user id");
    }
  });
});

describe("taking over the old database", () => {
  it("reads the Clerk ids from the server_user_id settings and nothing else", () => {
    expect(clerkIdsIn(["server_user_id:user_a", "device_status:u1", "server_user_id:", "server_user_id:user_b"])).toEqual(["user_a", "user_b"]);
  });

  it("is theirs when it records them, or nobody; not when it records only someone else", () => {
    expect(legacyIsTheirs(["user_a", "user_b"], "user_b")).toBe(true);
    expect(legacyIsTheirs([], "user_b")).toBe(true);
    expect(legacyIsTheirs(["user_a"], "user_b")).toBe(false);
  });
});

describe("notesStep", () => {
  it("opens the signed-in person's notes once Clerk has loaded", () => {
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: true, clerkUserId: "user_a" })).toEqual({ kind: "open", user: "user_a" });
  });

  it("closes them when Clerk says nobody is signed in", () => {
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: false, clerkUserId: null })).toEqual({ kind: "close" });
  });

  it("leaves them while Clerk is loading, or signed in without an id yet", () => {
    expect(notesStep({ clerkLoaded: false, clerkSignedIn: undefined, clerkUserId: undefined })).toEqual({ kind: "keep" });
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: true, clerkUserId: null })).toEqual({ kind: "keep" });
  });
});
