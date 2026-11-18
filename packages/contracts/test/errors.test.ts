import { describe, expect, test } from "vitest";
import {
  ApiErrorSchema,
  ERROR_CODES,
  InsufficientCreditsErrorSchema,
  STATUS_FOR_CODE,
  apiError,
} from "../src/errors.ts";

describe("STATUS_FOR_CODE", () => {
  test("covers every error code with the specified status", () => {
    expect(Object.keys(STATUS_FOR_CODE).sort()).toEqual([...ERROR_CODES].sort());
    expect(STATUS_FOR_CODE).toEqual({
      bad_request: 400,
      unauthorized: 401,
      forbidden: 403,
      plan_required: 403,
      not_found: 404,
      conflict: 409,
      insufficient_credits: 402,
      rate_limited: 429,
      internal: 500,
    });
  });
});

describe("ApiErrorSchema", () => {
  test("accepts a valid error with retry_after null, 0 and 30", () => {
    expect(ApiErrorSchema.safeParse({ code: "not_found", message: "Gone", retry_after: null }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: "internal", message: "Retry", retry_after: 0 }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: "rate_limited", message: "Slow down", retry_after: 30 }).success).toBe(true);
  });

  test("rejects a missing retry_after key", () => {
    expect(ApiErrorSchema.safeParse({ code: "internal", message: "x" }).success).toBe(false);
  });

  test("rejects an unknown code", () => {
    expect(ApiErrorSchema.safeParse({ code: "teapot", message: "x", retry_after: null }).success).toBe(false);
  });

  test("rejects an empty message", () => {
    expect(ApiErrorSchema.safeParse({ code: "internal", message: "", retry_after: null }).success).toBe(false);
  });

  test("rejects a negative or non-integer retry_after", () => {
    expect(ApiErrorSchema.safeParse({ code: "internal", message: "x", retry_after: -1 }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: "internal", message: "x", retry_after: 1.5 }).success).toBe(false);
  });

  test("rejects extra keys", () => {
    expect(
      ApiErrorSchema.safeParse({ code: "internal", message: "x", retry_after: null, detail: "no" }).success,
    ).toBe(false);
  });
});

describe("InsufficientCreditsErrorSchema", () => {
  test("accepts a shortfall of at least 1", () => {
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "insufficient_credits",
        message: "Out of credits",
        retry_after: null,
        shortfall: 5,
      }).success,
    ).toBe(true);
  });

  test("rejects a fractional shortfall", () => {
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "insufficient_credits",
        message: "Out of credits",
        retry_after: null,
        shortfall: 1.5,
      }).success,
    ).toBe(false);
  });

  test("rejects a shortfall of 0", () => {
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "insufficient_credits",
        message: "Out of credits",
        retry_after: null,
        shortfall: 0,
      }).success,
    ).toBe(false);
  });

  test("rejects another code and a missing shortfall", () => {
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "internal",
        message: "x",
        retry_after: null,
        shortfall: 5,
      }).success,
    ).toBe(false);
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "insufficient_credits",
        message: "x",
        retry_after: null,
      }).success,
    ).toBe(false);
  });

  test("rejects extra keys", () => {
    expect(
      InsufficientCreditsErrorSchema.safeParse({
        code: "insufficient_credits",
        message: "x",
        retry_after: null,
        shortfall: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("apiError", () => {
  test("builds a value that parses with ApiErrorSchema", () => {
    const err = apiError("conflict", "Already exists");
    expect(err).toEqual({ code: "conflict", message: "Already exists", retry_after: null });
    expect(ApiErrorSchema.parse(err)).toEqual(err);
  });

  test("keeps retry_after when given", () => {
    expect(apiError("rate_limited", "Slow down", 12)).toEqual({
      code: "rate_limited",
      message: "Slow down",
      retry_after: 12,
    });
  });
});
