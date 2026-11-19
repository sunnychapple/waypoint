import { describe, expect, test } from "vitest";
import { verifySvix, WebhookSecretError, type SvixHeaders } from "../src/webhooks/svix.ts";

const SECRET = "whsec_" + btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const NOW = 1_614_265_330_000;

async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.slice("whsec_".length)), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const EXAMPLE_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const EXAMPLE_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const EXAMPLE_TS = "1614265330";
const EXAMPLE_BODY = '{"test": 2432232314}';
const EXAMPLE_SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

function headers(id: string | undefined, timestamp: string | undefined, signature: string | undefined): SvixHeaders {
  return { id, timestamp, signature };
}

describe("verifySvix", () => {
  test("Svix's published example verifies", async () => {
    const ok = await verifySvix(
      EXAMPLE_SECRET,
      headers(EXAMPLE_ID, EXAMPLE_TS, EXAMPLE_SIGNATURE),
      EXAMPLE_BODY,
      1_614_265_330_000,
    );
    expect(ok).toBe(true);
  });

  test("the example with one character of the body changed is false", async () => {
    const ok = await verifySvix(
      EXAMPLE_SECRET,
      headers(EXAMPLE_ID, EXAMPLE_TS, EXAMPLE_SIGNATURE),
      '{"test": 2432232315}',
      1_614_265_330_000,
    );
    expect(ok).toBe(false);
  });

  test("the example with another id is false", async () => {
    const ok = await verifySvix(
      EXAMPLE_SECRET,
      headers("msg_other", EXAMPLE_TS, EXAMPLE_SIGNATURE),
      EXAMPLE_BODY,
      1_614_265_330_000,
    );
    expect(ok).toBe(false);
  });

  test("the example with another timestamp is false", async () => {
    const ok = await verifySvix(
      EXAMPLE_SECRET,
      headers(EXAMPLE_ID, "1614265331", EXAMPLE_SIGNATURE),
      EXAMPLE_BODY,
      1_614_265_331_000,
    );
    expect(ok).toBe(false);
  });

  test("a good signature is true", async () => {
    const timestamp = String(NOW / 1000);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(true);
  });

  test("a signature made with another secret is false", async () => {
    const timestamp = String(NOW / 1000);
    const other = "whsec_" + btoa("another secret that is long enough");
    const signature = await sign(other, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(false);
  });

  test("a header with a bad v1 signature and a good one is true", async () => {
    const timestamp = String(NOW / 1000);
    const good = await sign(SECRET, "msg_1", timestamp, "{}");
    const ok = await verifySvix(SECRET, headers("msg_1", timestamp, `v1,AAAA ${good}`), "{}", NOW);
    expect(ok).toBe(true);
  });

  test("a v2 signature alone is false", async () => {
    const timestamp = String(NOW / 1000);
    const good = await sign(SECRET, "msg_1", timestamp, "{}");
    const ok = await verifySvix(SECRET, headers("msg_1", timestamp, good.replace("v1,", "v2,")), "{}", NOW);
    expect(ok).toBe(false);
  });

  test("a v1 signature that is not base64 is false and does not throw", async () => {
    const timestamp = String(NOW / 1000);
    const ok = await verifySvix(SECRET, headers("msg_1", timestamp, "v1,!!!"), "{}", NOW);
    expect(ok).toBe(false);
  });

  test("an empty signature header is false", async () => {
    const timestamp = String(NOW / 1000);
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, ""), "{}", NOW)).toBe(false);
  });

  test("a timestamp 300 seconds before now is true", async () => {
    const timestamp = String(NOW / 1000 - 300);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(true);
  });

  test("a timestamp 300 seconds after now is true", async () => {
    const timestamp = String(NOW / 1000 + 300);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(true);
  });

  test("a timestamp 301 seconds before now is false", async () => {
    const timestamp = String(NOW / 1000 - 301);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(false);
  });

  test("a timestamp 301 seconds after now is false", async () => {
    const timestamp = String(NOW / 1000 + 301);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(false);
  });

  test.each(["abc", ""])("a timestamp of %j is false", async (timestamp) => {
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers("msg_1", timestamp, signature), "{}", NOW)).toBe(false);
  });

  test("a missing id is false", async () => {
    const timestamp = String(NOW / 1000);
    const signature = await sign(SECRET, "msg_1", timestamp, "{}");
    expect(await verifySvix(SECRET, headers(undefined, timestamp, signature), "{}", NOW)).toBe(false);
  });

  test("a missing timestamp is false", async () => {
    const signature = await sign(SECRET, "msg_1", String(NOW / 1000), "{}");
    expect(await verifySvix(SECRET, headers("msg_1", undefined, signature), "{}", NOW)).toBe(false);
  });

  test("a missing signature is false", async () => {
    expect(await verifySvix(SECRET, headers("msg_1", String(NOW / 1000), undefined), "{}", NOW)).toBe(false);
  });

  test("a secret without whsec_ throws WebhookSecretError", async () => {
    await expect(verifySvix("not-a-secret", headers("msg_1", "1", "v1,AAAA"), "{}", NOW)).rejects.toBeInstanceOf(
      WebhookSecretError,
    );
  });

  test("the secret 'whsec_' alone throws WebhookSecretError", async () => {
    await expect(verifySvix("whsec_", headers("msg_1", "1", "v1,AAAA"), "{}", NOW)).rejects.toBeInstanceOf(
      WebhookSecretError,
    );
  });

  test("the secret 'whsec_***' throws WebhookSecretError", async () => {
    await expect(verifySvix("whsec_***", headers("msg_1", "1", "v1,AAAA"), "{}", NOW)).rejects.toBeInstanceOf(
      WebhookSecretError,
    );
  });
});
