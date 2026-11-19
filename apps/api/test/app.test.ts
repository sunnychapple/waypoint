import { HTTPException } from "hono/http-exception";
import { describe, expect, test } from "vitest";
import { ApiErrorSchema, type ApiError } from "@waypoint/contracts";
import { createApp } from "../src/app.ts";
import { ApiFailure } from "../src/errors.ts";

const env = { DB: {} as D1Database, CONFIG: {} as KVNamespace };
const VALID_KEY = "abcdefghijklmnop";

function setup() {
  const app = createApp();
  app.get("/throw-rate", () => {
    throw new ApiFailure("rate_limited", "slow down", 30);
  });
  app.get("/throw-plain", () => {
    throw new Error("secret detail");
  });
  app.get("/throw-401", () => {
    throw new HTTPException(401);
  });
  app.get("/throw-418", () => {
    throw new HTTPException(418);
  });
  app.all("/v1/x", (c) => c.json({ reached: true }));
  app.post("/webhooks/x", (c) => c.json({ reached: true }));
  return app;
}

describe("error replies", () => {
  test("an unknown path gives 404 with the not_found body", async () => {
    const res = await setup().request("/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "no such endpoint", retry_after: null });
  });

  test("an ApiFailure gives its status, body and Retry-After", async () => {
    const res = await setup().request("/throw-rate", {}, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited", message: "slow down", retry_after: 30 });
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  test("a plain Error gives 500 internal and does not leak its message", async () => {
    const res = await setup().request("/throw-plain", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiError;
    expect(body).toEqual({ code: "internal", message: "something went wrong", retry_after: null });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  test("HTTPException(401) gives 401 unauthorized", async () => {
    const res = await setup().request("/throw-401", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "request failed", retry_after: null });
  });

  test("HTTPException(418) gives 500 internal", async () => {
    const res = await setup().request("/throw-418", {}, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "request failed", retry_after: null });
  });

  test("every error body passes ApiErrorSchema", async () => {
    const app = setup();
    const paths = ["/nope", "/throw-rate", "/throw-plain", "/throw-401", "/throw-418"];
    for (const path of paths) {
      const res = await app.request(path, {}, env);
      const body: unknown = await res.json();
      expect(() => ApiErrorSchema.parse(body)).not.toThrow();
    }
  });
});

describe("Idempotency-Key check", () => {
  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with no key gives 400 bad_request", async (method) => {
    const res = await setup().request("/v1/x", { method }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Idempotency-Key header required",
      retry_after: null,
    });
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with a 15-character key gives 400", async (method) => {
    const res = await setup().request("/v1/x", { method, headers: { "Idempotency-Key": "a".repeat(15) } }, env);
    expect(res.status).toBe(400);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with a valid key reaches the route", async (method) => {
    const res = await setup().request("/v1/x", { method, headers: { "Idempotency-Key": VALID_KEY } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  test("GET /v1/x with no key reaches the route", async () => {
    const res = await setup().request("/v1/x", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  test("POST /webhooks/x with no key reaches the route", async () => {
    const res = await setup().request("/webhooks/x", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });
});
