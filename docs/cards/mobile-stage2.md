# Mobile cards, stage 2: the app talks to the API

This file holds the full cards for **stage 2** of the iPhone app, and a short outline of the cards that come after it. It continues `docs/cards/mobile.md`: section 1 of that file (versions, the monorepo, tests, commands and "Rules for every mobile card") applies to every card here, word for word. Read it first. The spec is `docs/architecture.md`; the crypto design is `docs/security.md`.

Stage 2 is: a typed API client, the config and update check, this iPhone's keys in the Secure Enclave, registering this iPhone after sign-in, purchases, Explain, the Plans screens, push, and the cloud and privacy settings. After stage 2 the app can buy credits and spend them on Explain.

Written 19 Nov 2026 against `main` at `57d1577` (S3 merged; M11b and M12 not yet merged). Every server route used here is merged: PR 12 (quote), PR 14 and 15 (explain, more detail, double-check), PR 16 (wallet), PR 17 (Apple purchases), PR 31 (push tokens), PR 32 (zero retention, activity), S1A to S1C, S1E, S3.

**Numbering.** This file follows the owner's numbering for stage 2: M15 and M16 are the Explain bundle, M17 is the Plans bundle. The outline in `docs/cards/mobile.md` had Plans as M15 and "Questions for later" as M17; "Questions for later" is now **M33** (outline below). M26 is split into M26a (Swift logic, tested on the Mac) and M26b (the Expo module). One server card, **S1G**, is added here because stage 2 cannot work without it (it is the first card in section 3).

**Design boards.** The screen copy below comes from `docs/architecture.md` (for example the lines "Sent for this task only" and "Not stored in the cloud") and from the stage 1 cards. The boards for D1–D8, O1–O14, J5 and K2 could not be opened while these cards were written. Where a card writes its own copy, it says so; the owner should check it against the boards before the card is built.

## 0. Cards in this file

| Card | Title | After | Sittings | Needs Xcode for |
|---|---|---|---|---|
| S1G | Server: `GET /v1/devices` also returns the user id | S1B (merged) | 1 | — |
| M3 | `packages/api-client`: typed client, signing, Idempotency-Key, 409 and 402 | S1G | 1 | — |
| M13 | The API client in the app, `GET /v1/config`, "Update Waypoint" | M3 | 1 | device check |
| M26a | Native crypto logic (`KeysCore`), passing every published vector | M5 (merged) | 1 | — |
| M26b | Native module `waypoint-keys`: Secure Enclave keys, Keychain, request signing | M26a | 1 | device check |
| M27a | Register this iPhone after sign-in, and the "waiting for approval" path | M13, M26b, S1G | 1 | device check |
| M14 | Native module `waypoint-store`: StoreKit 2 purchases to `POST /v1/purchases/apple` | M27a | 1 | device check |
| M17 | Plans bundle (`src/features/plans`): balance, Own it, Plus, credit packs, restore, out of credits | M14 | 1 | device check |
| M15 | Explain bundle, part A: tap a word, explain (streamed), `sent_log`, "Sent for this task only" | M17, M10b, M10c | 1 | device check |
| M16 | Explain bundle, part B: more detail, double-check, the thread, save, "What was sent" | M15 | 1 | device check |
| M20 | Push: token to `POST /v1/push-tokens`, taps, "approved" notice | M27a | 1 | device check |
| M21 | Settings: cloud activity and zero retention (Plus only) | M12, M16 | 1 | device check |

Merge order: S1G, M3, M13, M26a, M26b, M27a, M14, M17, M15, M16, M20, M21. M26a can be built at any time, beside the others. M17 merges before M15 because Explain's "Get credits" button opens the Plans route.

Every card can be written, type-checked, tested in Node, bundled (`npm run export:ios -w @waypoint/mobile`) and have its Swift `Core` tested with `swift test` on the current Mac. "Device check" steps need macOS Tahoe 26.6 and Xcode 27.2 (`docs/cards/mobile.md` section 0); until then a card is merged with them marked "not run: no Xcode yet", and they are run on the iPhone later, in card order.

## 1. What stage 2 adds to the rules

These come on top of `AGENTS.md` and "Rules for every mobile card" in `docs/cards/mobile.md`.

1. **Folders.** New feature folders: `src/features/explain/`, `src/features/plans/`. New core folders: `src/core/config/`, `src/core/device/`, `src/core/store/`, `src/core/explain/`, `src/core/cloud/`, `src/core/push/`. The boundary test from M1a already covers them: core imports only `src/core`, `@waypoint/contracts`, `zod` and `ts-fsrs`. Core never imports `@waypoint/api-client`; it works on plain data, and `src/platform/` converts.
2. **Network.** Only `src/platform/api.ts` (M13) creates the API client, and only `src/platform/` calls it. Features call platform functions. No feature calls `fetch`.
3. **What leaves the phone.** Stage 2 sends the server: the Clerk token, this device's public keys and certificate, signed purchase transactions, the push token, the zero-retention switch, and — only when the person taps to run a cloud task — the word, the transcript excerpt and the explanation shown. Every task's text is written to `sent_log` **before** it is sent (M15). Nothing else: no note text, page text, file or search data.
4. **Money.** A paid task or a purchase needs this iPhone to be registered and approved (`docs/build-plan.md`, decision 5). The app checks this before it starts StoreKit or sends a task (M27a's `requireApprovedDevice()`), so nobody pays Apple before the app can tell the server.
5. **Idempotency-Key.** One key per thing the person asked for, made when they tap, kept across automatic retries, and kept for "Try again" after "Out of credits" (the server releases a hold that could not be made, so the same request can run after a purchase). "Try again" after a failed answer uses a new key (`docs/architecture.md` section 4).
6. **Environment.** `apps/mobile/.env.local` (git-ignored) gains `EXPO_PUBLIC_API_URL=https://<api host>` (no trailing slash) and, once the App Store record exists, `EXPO_PUBLIC_APP_STORE_ID=<numeric Apple id>`.
7. **Swift crypto exception.** `modules/waypoint-keys/ios/Core/` imports Foundation **and CryptoKit**. CryptoKit is part of macOS, so `swift test` runs it on the Mac with no Xcode; this is the only `Core` folder allowed a second import.

## 2. Owner setup added by stage 2

Add to `docs/build-plan.md` "Owner setup" when convenient (this file does not edit it):

- `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local` (the Worker's URL).
- Apple Developer portal: turn on **Push Notifications** for the app id. In-App Purchase needs no capability change.
- App Store Connect: the Paid Apps agreement signed (StoreKit returns no products without it), the six products from `docs/architecture.md` section 7 in "Ready to Submit" or approved, and a **Sandbox tester** account for the device checks. Make `waypoint.own_it` and the Plus group family-shareable only if Family Sharing is wanted (open question 11 in `docs/build-plan.md`).
- After the App Store record exists: `EXPO_PUBLIC_APP_STORE_ID` for the "Update Waypoint" button (M13).

---

## 3. Stage 2 cards

In merge order. Each card is one pull request and one sitting.

### S1G · Server: `GET /v1/devices` also returns the user id

Branch `pr/s1g-devices-user-id`. After S1B (merged). No new dependencies. Files: `packages/contracts/src/keys.ts`, `apps/api/src/devices/register.ts`, `apps/api/test/devices.test.ts`. Nothing else.

Why: the app needs the server's id for the signed-in person (`users.id`, a UUID made by the API) and has no way to learn it today. Three things need it:
- the first device's certificate signs `context("device-cert", user id, device id, sign_pub, box_pub)`, and S1B checks it with `users.id` (`docs/security.md` section 6);
- StoreKit's `appAccountToken` must be the user id (`docs/architecture.md` flow 5; PR 17 compares it with `users.id`);
- the Keychain keeps this device's keys per user (M26b), so two people can share one iPad.

The Clerk session carries only Clerk's id. `GET /v1/devices` is the first call the app makes after sign-in (M27a), so it carries the id. This is a server card in a mobile file only because the mobile track found the gap; it touches no mobile code. Add it to the "Build order" table in `docs/build-plan.md` (batch 6) when it is accepted.

`packages/contracts/src/keys.ts`: change one line.

```ts
export const DeviceListSchema = z.strictObject({ user_id: KeyIdSchema, devices: z.array(DeviceViewSchema) });
```

`apps/api/src/devices/register.ts`, in the `.get("/v1/devices", ...)` handler: change the reply line.

```ts
      return c.json({ user_id: c.get("user").id, devices: rows.results });
```

`apps/api/test/devices.test.ts`, in the test "lists the user's non-removed rows in order, passes DeviceListSchema, …": add one line after `const list = DeviceListSchema.parse(body);`:

```ts
    expect(list.user_id).toBe("u1");
```

Checked here: with these three changes `npx vitest run test/devices.test.ts` in `apps/api` passes (12 tests) and the root `npm run typecheck` is clean for `apps/api` and `packages/contracts`.

Not in this PR: any other field, a `GET /v1/me` endpoint, Clerk metadata.

---

### M3 · `packages/api-client`: typed client, signing, Idempotency-Key, 409 and 402

Branch `pr/m3-api-client`. After S1G. Files: `packages/api-client/package.json`, `tsconfig.json`, `src/index.ts`, `src/errors.ts`, `src/sse.ts`, `src/client.ts`, `test/helpers.ts`, `test/client.test.ts`, `test/sse.test.ts`, plus `package-lock.json`. Nothing under `apps/`.

Why it looks like this:
- One client for every route stage 2 uses, on top of `packages/contracts`: every reply is checked with the contract's zod schema, so a server change that breaks the app shows up as `BadReplyError`, not as bad data on screen.
- It runs on any `fetch`. The app passes `expo/fetch` (it streams response bodies, which React Native's own `fetch` does not); the tests pass a fake. So the whole package is tested in Node.
- It never holds a key. Device signatures come from an injected **signer** (`docs/security.md` section 7). On the phone the signer is the Secure Enclave (M26b); in the tests it is a software key that signs with `requestSigningInput` from `packages/crypto`, and the server's own check, `verifyP256`, verifies it. A test also checks the published `waypoint-v1.json` request vector.
- The rules from `docs/architecture.md` section 4 live here once: the Clerk token on every call except `GET /v1/config`; an `Idempotency-Key` on every write, the same key on every automatic retry; each retry signed again with a new nonce and timestamp; 402 carries the shortfall; 409 "request in progress" (`retry_after` set) waits and retries; a clock that is far off is corrected from the `Date` header.
- **Paid tasks are never retried automatically** (`retry: false`): explain, more detail and double-check. Their replies are not stored by the server; a second send with the same key while the first is running gets 409, and after it finished gets 409 "request already finished". Trying again is the person's choice (M15).
- Streams: `POST /v1/tasks/explain` and `/more-detail` answer with server-sent events: any number of `delta` (`{ text }`), then one `done` (`StreamDone`) or one `error` (the error shape) (`packages/contracts/src/instant.ts`, `apps/api/src/tasks/instant.ts`). The client calls `onDelta` for each piece and returns `done`, or throws.
- No async generators: Hermes support for them is not guaranteed, so `readSse` takes a callback.

`packages/api-client/package.json`, exactly:

```json
{
  "name": "@waypoint/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@waypoint/contracts": "0.0.0",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.20261118.1",
    "@types/node": "24.19.2",
    "@waypoint/crypto": "0.0.0"
  }
}
```

`@cloudflare/workers-types` and `@types/node` are for type-checking `packages/crypto` (imported by the tests only) the same way that package does; they are never bundled.

`packages/api-client/tsconfig.json`, exactly:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types", "node"] },
  "include": ["src", "test"]
}
```

`src/index.ts`, exactly:

```ts
export * from "./errors.ts";
export * from "./sse.ts";
export * from "./client.ts";
```

`src/errors.ts`, exactly:

```ts
import { ApiErrorSchema, InsufficientCreditsErrorSchema, type ErrorCode } from "@waypoint/contracts";

// The server answered with the one error shape (docs/architecture.md section 4). status is the HTTP status, or 200
// when a streamed answer ended with an "error" event.
export class ApiCallError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryAfter: number | null;
  readonly shortfall: number | null; // set only for 402 insufficient_credits

  constructor(status: number, code: ErrorCode, message: string, retryAfter: number | null, shortfall: number | null = null) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.shortfall = shortfall;
  }
}

// No reply at all (offline, timed out, connection dropped), or a stream that ended before "done" or "error".
export class NetworkError extends Error {
  constructor(message = "network error") {
    super(message);
    this.name = "NetworkError";
  }
}

// A reply that does not match the contract.
export class BadReplyError extends Error {
  constructor(message = "unexpected reply") {
    super(message);
    this.name = "BadReplyError";
  }
}

// A signed call was made before this device was registered (or while it waits for approval).
export class NotRegisteredError extends Error {
  constructor() {
    super("this device is not registered");
    this.name = "NotRegisteredError";
  }
}

// Turns any error reply into an ApiCallError. A body that is not the error shape becomes "internal".
export function errorFromBody(status: number, body: unknown): ApiCallError {
  const short = InsufficientCreditsErrorSchema.safeParse(body);
  if (status === 402 && short.success) {
    return new ApiCallError(status, short.data.code, short.data.message, short.data.retry_after, short.data.shortfall);
  }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new ApiCallError(status, parsed.data.code, parsed.data.message, parsed.data.retry_after);
  return new ApiCallError(status, "internal", "something went wrong", null);
}
```

`src/sse.ts`, exactly:

```ts
// Reads server-sent events from a response body (the API writes them with hono's streamSSE, "\n" line endings):
// blocks separated by a blank line, each with "event:" and "data:" lines; several data lines join with "\n".
// Comment lines (":") and other fields are ignored. onEvent returning false stops reading.
export type SseEvent = { event: string; data: string };

export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = done ? "" : (blocks.pop() ?? "");
      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed !== null && !onEvent(parsed)) return;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}
```

`src/client.ts`, exactly. This was type-checked under this package's tsconfig **and** under `apps/mobile/tsconfig.json` (with `expo/fetch` passed as `fetch`), and bundled with `npm run export:ios`:

```ts
import {
  ActivityResponseSchema,
  ApiErrorSchema,
  ApplePurchaseResponseSchema,
  ConfigResponseSchema,
  DeviceListSchema,
  DeviceViewSchema,
  DoubleCheckResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  PushTokenResponseSchema,
  QuoteResponseSchema,
  StreamDeltaSchema,
  StreamDoneSchema,
  WalletResponseSchema,
  ZeroRetentionResponseSchema,
  type ActivityResponse,
  type ApplePurchaseResponse,
  type ConfigResponse,
  type DeviceView,
  type DoubleCheckResponse,
  type ExplainRequest,
  type FollowUpRequest,
  type PushTokenRequest,
  type PushTokenResponse,
  type QuoteRequest,
  type QuoteResponse,
  type RegisterDeviceRequest,
  type StreamDone,
  type WalletResponse,
  type ZeroRetentionResponse,
} from "@waypoint/contracts";
import { z } from "zod";
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError, errorFromBody } from "./errors.ts";
import { readSse } from "./sse.ts";

export type FetchInit = { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal };
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

// Signs one request with a device key (docs/security.md section 7). It makes a new nonce on every call; the
// client passes a new timestamp on every attempt, so a retry is signed again.
export type SignInput = { method: string; target: string; deviceId: string; timestamp: number; body: string };
export type Signer = (input: SignInput) => Promise<{ nonce: string; signature: string }>;
export type DeviceSigner = { id: string; sign: Signer };

export type ApiClientOptions = {
  baseUrl: string; // no trailing slash
  fetch: FetchLike;
  getToken: () => Promise<string | null>; // the Clerk session token
  device: () => DeviceSigner | null; // this device once it is registered and approved, else null
  now: () => number;
  newKey: () => string; // a new Idempotency-Key, 16 to 64 of [A-Za-z0-9_-]
  sleep: (ms: number) => Promise<void>;
};

export type StreamOptions = { key: string; onDelta: (text: string) => void; signal?: AbortSignal };

export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [500, 2000] as const;
const SKEW_RETRY_MS = 60_000;

type Signing = "none" | "device" | { register: DeviceSigner };

type CallSpec = {
  method: "GET" | "POST" | "PUT";
  target: string; // path and query, starting with "/v1/"
  body?: unknown;
  key?: string; // Idempotency-Key; writes get a new one when absent
  token?: boolean; // default true; false only for GET /v1/config
  signing?: Signing;
  retry: boolean; // false for paid tasks: Try again must be the person's choice
  signal?: AbortSignal;
  accept?: string;
};

const RegisteredSchema = z.strictObject({ device: DeviceViewSchema });

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions) {
  // Server time minus device time, from the Date header of the latest reply.
  let clockOffset = 0;

  function noteDate(reply: Response): void {
    const date = reply.headers.get("Date");
    if (date === null) return;
    const server = Date.parse(date);
    if (!Number.isNaN(server)) clockOffset = server - options.now();
  }

  async function attempt(spec: CallSpec, key: string | undefined): Promise<{ reply: Response; signedOffset: number | null }> {
    const body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
    const headers: Record<string, string> = { Accept: spec.accept ?? "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
    if (spec.token !== false) {
      const token = await options.getToken();
      if (token === null) throw new ApiCallError(401, "unauthorized", "sign in required", null);
      headers.Authorization = `Bearer ${token}`;
    }
    let signedOffset: number | null = null;
    const signing = spec.signing ?? "none";
    if (signing !== "none") {
      const signer = signing === "device" ? options.device() : signing.register;
      if (signer === null) throw new NotRegisteredError();
      const deviceId = signing === "device" ? signer.id : "new";
      signedOffset = clockOffset;
      const timestamp = options.now() + clockOffset;
      const signed = await signer.sign({ method: spec.method, target: spec.target, deviceId, timestamp, body: body ?? "" });
      headers["Waypoint-Device"] = deviceId;
      headers["Waypoint-Timestamp"] = String(timestamp);
      headers["Waypoint-Nonce"] = signed.nonce;
      headers["Waypoint-Signature"] = signed.signature;
    }
    const init: FetchInit = { method: spec.method, headers };
    if (body !== undefined) init.body = body;
    if (spec.signal !== undefined) init.signal = spec.signal;
    let reply: Response;
    try {
      reply = await options.fetch(options.baseUrl + spec.target, init);
    } catch (error) {
      if (spec.signal?.aborted === true) throw error;
      throw new NetworkError();
    }
    noteDate(reply);
    return { reply, signedOffset };
  }

  // Sends the request, retrying when that is safe, and returns the first 2xx reply. Throws ApiCallError for an
  // error reply, NetworkError when no reply came.
  async function send(spec: CallSpec): Promise<Response> {
    const key = spec.method === "GET" ? undefined : (spec.key ?? options.newKey());
    let skewRetried = false;
    for (let n = 1; ; n++) {
      const last = n >= MAX_ATTEMPTS;
      let result: { reply: Response; signedOffset: number | null };
      try {
        result = await attempt(spec, key);
      } catch (error) {
        if (error instanceof NetworkError && spec.retry && !last) {
          await options.sleep(BACKOFF_MS[n - 1] ?? 2000);
          continue;
        }
        throw error;
      }
      const { reply, signedOffset } = result;
      if (reply.ok) return reply;
      const failure = errorFromBody(reply.status, await reply.json().catch(() => null));
      // A clock far off makes the signature too old or too new: sign again once with the server's time.
      if (reply.status === 401 && signedOffset !== null && !skewRetried && Math.abs(clockOffset - signedOffset) > SKEW_RETRY_MS) {
        skewRetried = true;
        continue;
      }
      const busy = reply.status === 409 && failure.retryAfter !== null; // "request in progress"
      const serverError = reply.status >= 500;
      if (spec.retry && !last && (busy || serverError)) {
        await options.sleep(busy ? (failure.retryAfter ?? 1) * 1000 : (BACKOFF_MS[n - 1] ?? 2000));
        continue;
      }
      throw failure;
    }
  }

  async function json<T>(spec: CallSpec, schema: z.ZodType<T>): Promise<T> {
    const reply = await send(spec);
    const parsed = schema.safeParse(await reply.json().catch(() => undefined));
    if (!parsed.success) throw new BadReplyError();
    return parsed.data;
  }

  // A streamed task: "delta" events, then one "done" or one "error" (packages/contracts instant.ts).
  async function stream(target: string, body: unknown, opts: StreamOptions): Promise<StreamDone> {
    const spec: CallSpec = { method: "POST", target, body, key: opts.key, signing: "device", retry: false, accept: "text/event-stream" };
    if (opts.signal !== undefined) spec.signal = opts.signal;
    const reply = await send(spec);
    if (reply.body === null) throw new NetworkError("stream ended early");
    const state: { outcome: StreamDone | ApiCallError | null; bad: boolean } = { outcome: null, bad: false };
    try {
      await readSse(reply.body, ({ event, data }) => {
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          state.bad = true;
          return false;
        }
        if (event === "delta") {
          const delta = StreamDeltaSchema.safeParse(value);
          if (!delta.success) {
            state.bad = true;
            return false;
          }
          opts.onDelta(delta.data.text);
          return true;
        }
        if (event === "done") {
          const done = StreamDoneSchema.safeParse(value);
          if (done.success) state.outcome = done.data;
          else state.bad = true;
          return false;
        }
        if (event === "error") {
          const error = ApiErrorSchema.safeParse(value);
          state.outcome = error.success
            ? new ApiCallError(200, error.data.code, error.data.message, error.data.retry_after)
            : new ApiCallError(200, "internal", "something went wrong", null);
          return false;
        }
        return true;
      });
    } catch (error) {
      if (opts.signal?.aborted === true) throw error;
      throw new NetworkError("stream ended early");
    }
    if (state.bad) throw new BadReplyError();
    if (state.outcome === null) throw new NetworkError("stream ended early");
    if (state.outcome instanceof ApiCallError) throw state.outcome;
    return state.outcome;
  }

  return {
    config: (): Promise<ConfigResponse> => json({ method: "GET", target: "/v1/config", token: false, retry: true }, ConfigResponseSchema),
    wallet: (): Promise<WalletResponse> => json({ method: "GET", target: "/v1/wallet", retry: true }, WalletResponseSchema),
    quote: (request: QuoteRequest): Promise<QuoteResponse> =>
      json({ method: "POST", target: "/v1/tasks/quote", body: request, retry: true }, QuoteResponseSchema),
    explain: (request: ExplainRequest, opts: StreamOptions): Promise<StreamDone> => stream("/v1/tasks/explain", request, opts),
    moreDetail: (request: FollowUpRequest, opts: StreamOptions): Promise<StreamDone> => stream("/v1/tasks/more-detail", request, opts),
    doubleCheck: (request: FollowUpRequest, opts: { key: string; signal?: AbortSignal }): Promise<DoubleCheckResponse> => {
      const spec: CallSpec = { method: "POST", target: "/v1/tasks/double-check", body: request, key: opts.key, signing: "device", retry: false };
      if (opts.signal !== undefined) spec.signal = opts.signal;
      return json(spec, DoubleCheckResponseSchema);
    },
    applePurchase: (signedTransaction: string, key?: string): Promise<ApplePurchaseResponse> => {
      const spec: CallSpec = { method: "POST", target: "/v1/purchases/apple", body: { signed_transaction: signedTransaction }, signing: "device", retry: true };
      if (key !== undefined) spec.key = key;
      return json(spec, ApplePurchaseResponseSchema);
    },
    registerDevice: async (request: RegisterDeviceRequest, signer: DeviceSigner): Promise<DeviceView> =>
      (await json({ method: "POST", target: "/v1/devices", body: request, signing: { register: signer }, retry: true }, RegisteredSchema)).device,
    devices: () => json({ method: "GET", target: "/v1/devices", retry: true }, DeviceListSchema),
    pushToken: (request: PushTokenRequest): Promise<PushTokenResponse> =>
      json({ method: "POST", target: "/v1/push-tokens", body: request, retry: true }, PushTokenResponseSchema),
    setZeroRetention: (enabled: boolean): Promise<ZeroRetentionResponse> =>
      json({ method: "PUT", target: "/v1/settings/zero-retention", body: { enabled }, retry: true }, ZeroRetentionResponseSchema),
    activity: (before?: string): Promise<ActivityResponse> =>
      json({ method: "GET", target: before === undefined ? "/v1/activity" : `/v1/activity?before=${encodeURIComponent(before)}`, retry: true }, ActivityResponseSchema),
    clockOffset: (): number => clockOffset,
  };
}
```

The retry rules in `send`, in order:

| Reply | Retried? (`retry: true` calls only) | Wait |
|---|---|---|
| No reply (`NetworkError`) | yes, up to 3 attempts in all | 500 ms, then 2,000 ms |
| 401 to a signed call, and this reply's `Date` moved the clock offset by more than 60 s | once, signed again with the new offset (also for paid tasks: a 401 means nothing ran) | none |
| 409 with `retry_after` (request in progress) | yes | `retry_after` seconds |
| 500 to 599 | yes | 500 ms, then 2,000 ms |
| anything else (400, 402, 403, 404, 409 without `retry_after`, 429) | no: thrown as `ApiCallError` | — |

`test/helpers.ts`, exactly. It is the only place with Node APIs:

```ts
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bodySha256, requestSigningInput, toBase64Url, utf8 } from "@waypoint/crypto";
import { createApiClient, type ApiClientOptions, type DeviceSigner, type FetchInit } from "../src/index.ts";

export const BASE = "https://api.test";

export function readVectors<T>(name: string): T {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../crypto/test/vectors");
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

// A software P-256 key standing in for the Secure Enclave. Signs exactly what the server checks.
export function softwareSigner(id: string, key: KeyObject = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey): DeviceSigner & { publicKey: Uint8Array } {
  const publicKey = new Uint8Array(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-65));
  let counter = 0;
  return {
    id,
    publicKey,
    sign: async (input) => {
      counter += 1;
      const nonce = toBase64Url(new Uint8Array(16).fill(counter));
      const message = requestSigningInput({ ...input, nonce, bodySha256: await bodySha256(utf8(input.body)) });
      return { nonce, signature: toBase64Url(new Uint8Array(sign("sha256", message, { key, dsaEncoding: "ieee-p1363" }))) };
    },
  };
}

// The 32-byte private scalar from the vectors as a Node key.
export function keyFromScalar(hex: string, publicKey: Uint8Array): KeyObject {
  const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64(Buffer.from(hex, "hex")), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33, 65)) },
    format: "jwk",
  });
}

export type Sent = { url: string; init: FetchInit };

// A fake fetch that answers from a list of replies, one per call, and records every request.
export function fakeApi(replies: (Response | Error)[], overrides: Partial<ApiClientOptions> = {}) {
  const sent: Sent[] = [];
  const slept: number[] = [];
  let keys = 0;
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      sent.push({ url, init });
      const next = replies.shift();
      if (next === undefined) throw new Error("no more replies");
      if (next instanceof Error) throw next;
      return next;
    },
    getToken: async () => "tok_1",
    device: () => null,
    now: () => 1_763_560_000_000,
    newKey: () => `key_${String(++keys).padStart(12, "0")}`,
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...overrides,
  });
  return { client, sent, slept };
}

export function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function sseReply(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
```

`test/client.test.ts`, exactly (22 tests; all passed here):

```ts
import { bodySha256, fromBase64Url, requestSigningInput, utf8, verifyP256 } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "../src/index.ts";
import { BASE, fakeApi, jsonReply, keyFromScalar, readVectors, softwareSigner, sseReply } from "./helpers.ts";

const QUOTE = { credits: 1, price_table: "2026-11-16.2", retention: "standard", balance_after: 24, expires_in: 300 };
const PURCHASE = { transaction_id: "2000000000000001", product: "pack", credits: 1000, plan: "free" };
const DONE = { credits: 1, tier: "light", retention: "standard", offer_research: false };
const header = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

async function verifySent(sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }, publicKey: Uint8Array): Promise<boolean> {
  const h = sent.init.headers;
  const input = requestSigningInput({
    method: sent.init.method,
    target: sent.url.slice(BASE.length),
    deviceId: h["Waypoint-Device"] ?? "",
    timestamp: Number(h["Waypoint-Timestamp"]),
    nonce: h["Waypoint-Nonce"] ?? "",
    bodySha256: await bodySha256(utf8(sent.init.body ?? "")),
  });
  return verifyP256(publicKey, fromBase64Url(h["Waypoint-Signature"] ?? ""), input);
}

describe("plain calls", () => {
  it("GET /v1/config sends no token and no Idempotency-Key", async () => {
    const config = { prices: { version: "v", credits: { explain: 1 } }, routes_version: "r", flags: {}, min_native: { ios: "0.1.0" }, voice_pack: { version: "1", url: "https://x.test/p", sha256: "a".repeat(64), size: 1 } };
    const { client, sent } = fakeApi([jsonReply(200, config)]);
    expect(await client.config()).toEqual(config);
    expect(sent[0]?.url).toBe(`${BASE}/v1/config`);
    expect(header(sent[0]!, "Authorization")).toBeUndefined();
    expect(header(sent[0]!, "Idempotency-Key")).toBeUndefined();
  });

  it("a write carries the Clerk token, JSON body and a new Idempotency-Key", async () => {
    const { client, sent } = fakeApi([jsonReply(200, QUOTE)]);
    await client.quote({ task: "explain" });
    expect(header(sent[0]!, "Authorization")).toBe("Bearer tok_1");
    expect(header(sent[0]!, "Idempotency-Key")).toBe("key_000000000001");
    expect(header(sent[0]!, "Content-Type")).toBe("application/json");
    expect(sent[0]?.init.body).toBe('{"task":"explain"}');
    expect(header(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });

  it("signed out: 401 without calling the server", async () => {
    const { client, sent } = fakeApi([], { getToken: async () => null });
    await expect(client.wallet()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(sent).toHaveLength(0);
  });

  it("GET /v1/devices returns the user id with the list", async () => {
    const { client } = fakeApi([jsonReply(200, { user_id: "usr_1", devices: [] })]);
    expect(await client.devices()).toEqual({ user_id: "usr_1", devices: [] });
  });

  it("a reply that breaks the contract is BadReplyError", async () => {
    const { client } = fakeApi([jsonReply(200, { ...QUOTE, extra: 1 })]);
    await expect(client.quote({ task: "explain" })).rejects.toBeInstanceOf(BadReplyError);
  });
});

describe("errors and retries", () => {
  it("402 carries the shortfall and is not retried", async () => {
    const { client, sent } = fakeApi([jsonReply(402, { code: "insufficient_credits", message: "not enough credits", retry_after: null, shortfall: 15 })]);
    const error = await client.quote({ task: "research", depth: "quick" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiCallError);
    expect(error).toMatchObject({ status: 402, code: "insufficient_credits", shortfall: 15 });
    expect(sent).toHaveLength(1);
  });

  it("409 in progress waits retry_after and retries with the same key", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent, slept } = fakeApi(
      [jsonReply(409, { code: "conflict", message: "request in progress", retry_after: 1 }), jsonReply(200, PURCHASE)],
      { device: () => signer },
    );
    expect(await client.applePurchase("jws", "key_purchase_0001")).toEqual(PURCHASE);
    expect(slept).toEqual([1000]);
    expect(sent.map((s) => header(s, "Idempotency-Key"))).toEqual(["key_purchase_0001", "key_purchase_0001"]);
    // Signed again, with a new nonce.
    expect(header(sent[0]!, "Waypoint-Nonce")).not.toBe(header(sent[1]!, "Waypoint-Nonce"));
    expect(await verifySent(sent[1]!, signer.publicKey)).toBe(true);
  });

  it("409 without retry_after (another request with this key) is thrown at once", async () => {
    const { client, sent } = fakeApi([jsonReply(409, { code: "conflict", message: "Idempotency-Key reused with a different request", retry_after: null })]);
    await expect(client.setZeroRetention(true)).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(1);
  });

  it("network errors and 5xx retry up to 3 attempts with backoff, same key", async () => {
    const { client, sent, slept } = fakeApi([new TypeError("offline"), new Response("bad gateway", { status: 502 }), jsonReply(200, { zero_retention: true })]);
    expect(await client.setZeroRetention(true)).toEqual({ zero_retention: true });
    expect(slept).toEqual([500, 2000]);
    expect(new Set(sent.map((s) => header(s, "Idempotency-Key"))).size).toBe(1);
  });

  it("gives up after 3 attempts", async () => {
    const { client, sent } = fakeApi([new TypeError("x"), new TypeError("x"), new TypeError("x")]);
    await expect(client.wallet()).rejects.toBeInstanceOf(NetworkError);
    expect(sent).toHaveLength(3);
  });

  it("a non-JSON error body becomes internal", async () => {
    const { client } = fakeApi([new Response("<html>", { status: 400 })]);
    await expect(client.wallet()).rejects.toMatchObject({ status: 400, code: "internal" });
  });

  it("paid tasks are never retried automatically", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([new Response("x", { status: 503 })], { device: () => signer });
    await expect(client.doubleCheck({ word: "w", transcript: "t", answer: "a" }, { key: "key_task_00000001" })).rejects.toMatchObject({ status: 503 });
    expect(sent).toHaveLength(1);
  });
});

describe("device signatures", () => {
  it("a signed call without a registered device throws before sending", async () => {
    const { client, sent } = fakeApi([]);
    await expect(client.applePurchase("jws")).rejects.toBeInstanceOf(NotRegisteredError);
    expect(sent).toHaveLength(0);
  });

  it("signs method, path, device, timestamp, nonce and body hash", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([jsonReply(200, PURCHASE)], { device: () => signer });
    await client.applePurchase("jws");
    expect(header(sent[0]!, "Waypoint-Device")).toBe("dev_phone");
    expect(header(sent[0]!, "Waypoint-Timestamp")).toBe("1763560000000");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });

  it("registration signs with the device id \"new\"", async () => {
    const signer = softwareSigner("dev_phone");
    const device = { id: "dev_phone", kind: "device", name: "iPhone", platform: "ios", sign_pub: "A".repeat(87), box_pub: "A".repeat(87), cert: null, account_envelope: null, added_at: 1, approved_at: 1, approved_by: null };
    const { client, sent } = fakeApi([jsonReply(201, { device })]);
    expect(await client.registerDevice({ id: "dev_phone", name: "iPhone", platform: "ios", sign_pub: "A".repeat(87), box_pub: "A".repeat(87), commitment: "A".repeat(43) }, signer)).toEqual(device);
    expect(header(sent[0]!, "Waypoint-Device")).toBe("new");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });

  it("uses the server's clock from the Date header", async () => {
    const signer = softwareSigner("dev_phone");
    const server = new Date(1_763_560_000_000 + 600_000).toUTCString();
    const { client, sent } = fakeApi([jsonReply(200, QUOTE, { Date: server }), jsonReply(200, PURCHASE)], { device: () => signer });
    await client.quote({ task: "explain" });
    expect(client.clockOffset()).toBe(600_000);
    await client.applePurchase("jws");
    expect(header(sent[1]!, "Waypoint-Timestamp")).toBe("1763560600000");
  });

  it("a 401 that shows a clock off by more than a minute is signed again once", async () => {
    const signer = softwareSigner("dev_phone");
    const server = new Date(1_763_560_000_000 + 400_000).toUTCString();
    const unauthorized = jsonReply(401, { code: "unauthorized", message: "device signature required", retry_after: null }, { Date: server });
    const { client, sent } = fakeApi([unauthorized, jsonReply(200, PURCHASE)], { device: () => signer });
    await client.applePurchase("jws");
    expect(sent.map((s) => header(s, "Waypoint-Timestamp"))).toEqual(["1763560000000", "1763560400000"]);
  });

  it("matches the waypoint-v1 request vector", async () => {
    type RequestVector = { method: string; target: string; deviceId: string; timestamp: number; nonce: string; bodySha256: string; body_utf8: string; signing_input: string; device_private_key: string; device_sign_pub: string };
    const r = readVectors<{ request: RequestVector }>("waypoint-v1.json").request;
    const publicKey = fromBase64Url(r.device_sign_pub);
    const signer = softwareSigner(r.deviceId, keyFromScalar(r.device_private_key, publicKey));
    const signed = await signer.sign({ method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: r.body_utf8 });
    expect(await bodySha256(utf8(r.body_utf8))).toBe(r.bodySha256);
    const input = requestSigningInput({ ...r, nonce: signed.nonce });
    expect(await verifyP256(publicKey, fromBase64Url(signed.signature), input)).toBe(true);
  });
});

describe("streamed tasks", () => {
  it("passes deltas and returns done", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi(
      [sseReply(['event: delta\ndata: {"text":"Photo"}\n\n', 'event: delta\ndata: {"text":"synthesis"}\n', `\nevent: done\ndata: ${JSON.stringify(DONE)}\n\n`])],
      { device: () => signer },
    );
    const parts: string[] = [];
    expect(await client.explain({ word: "photosynthesis", transcript: "plants make food" }, { key: "key_explain_00001", onDelta: (t) => parts.push(t) })).toEqual(DONE);
    expect(parts).toEqual(["Photo", "synthesis"]);
    expect(header(sent[0]!, "Accept")).toBe("text/event-stream");
    expect(header(sent[0]!, "Idempotency-Key")).toBe("key_explain_00001");
  });

  it("an error event throws ApiCallError with status 200", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n', 'event: error\ndata: {"code":"internal","message":"model failed","retry_after":null}\n\n'])], { device: () => signer });
    await expect(client.moreDetail({ word: "w", transcript: "t", answer: "a" }, { key: "key_more_0000001", onDelta: () => undefined })).rejects.toMatchObject({ status: 200, code: "internal", message: "model failed" });
  });

  it("a stream that stops before done is a NetworkError", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n'])], { device: () => signer });
    await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00002", onDelta: () => undefined })).rejects.toBeInstanceOf(NetworkError);
  });

  it("a 402 before the stream starts carries the shortfall", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([jsonReply(402, { code: "insufficient_credits", message: "not enough credits", retry_after: null, shortfall: 1 })], { device: () => signer });
    await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00003", onDelta: () => undefined })).rejects.toMatchObject({ shortfall: 1 });
  });
});
```

`test/sse.test.ts`, exactly (3 tests: a chunk split inside "é", several data lines with comments and an unterminated last block, and stopping early cancels the reader):

```ts
import { describe, expect, it } from "vitest";
import { readSse, type SseEvent } from "../src/index.ts";

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
}
const enc = (s: string) => new TextEncoder().encode(s);

describe("readSse", () => {
  it("joins chunks, including a split UTF-8 character", async () => {
    const bytes = enc('event: delta\ndata: {"text":"café"}\n\n');
    const at = bytes.indexOf(0xc3) + 1;
    const got: SseEvent[] = [];
    await readSse(bodyOf([bytes.slice(0, 5), bytes.slice(5, at), bytes.slice(at)]), (e) => { got.push(e); return true; });
    expect(got).toEqual([{ event: "delta", data: '{"text":"café"}' }]);
  });
  it("multi data lines, comments, ids, empty blocks, last block", async () => {
    const got: SseEvent[] = [];
    await readSse(bodyOf([enc(": hi\nid: 1\nevent: a\ndata: x\ndata: y\n\nevent: b\n\ndata: z")]), (e) => { got.push(e); return true; });
    expect(got).toEqual([{ event: "a", data: "x\ny" }, { event: "message", data: "z" }]);
  });
  it("stops when onEvent returns false", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc("data: 1\n\ndata: 2\n\n")); }, cancel() { cancelled = true; } });
    const got: string[] = [];
    await readSse(body, (e) => { got.push(e.data); return false; });
    expect(got).toEqual(["1"]);
    expect(cancelled).toBe(true);
  });
});
```

Checks without Xcode, all of which must pass: root `npm install`, `npm run typecheck`, `npm test` (this package's tests included). Put a scratch file in `apps/mobile/src/platform/` that imports `createApiClient` and passes `fetch` from `expo/fetch`; `npm run typecheck -w @waypoint/mobile` passes; delete the file.

Device check: none (no app code yet; M13 wires it in).

Not in this PR: the app side (M13), jobs, groups, links and recovery routes (their cards add methods here), cancelling a running task, response caching.

---

### M13 · The API client in the app, `GET /v1/config`, "Update Waypoint"

Branch `pr/m13-config`. After M3. Dependencies: `@waypoint/api-client` 0.0.0 (workspace). Files, all under `apps/mobile/`: `package.json` (one dependency), `src/platform/api.ts`, `src/core/config/config.ts`, `src/platform/config.ts`, `src/shell/UpdateScreen.tsx`, `src/app/update.tsx`, `src/app/_layout.tsx` (one screen line), `src/app/(tabs)/_layout.tsx` (one hook call), `test/config.test.ts`. Plus `package-lock.json`.

Why it looks like this:
- `src/platform/api.ts` is the one place the app makes the API client (stage 2 rule 2). It passes `fetch` from `expo/fetch` (part of the `expo` package; it streams, which Explain needs), Clerk's token through `getClerkInstance()` (works outside React; `@clerk/expo` 4.15.1 exports it), `randomUUID` from `expo-crypto` for Idempotency-Keys (36 characters of `[0-9a-f-]`, inside the server's `^[A-Za-z0-9_-]{16,64}$`), and a device signer that M27a sets.
- `GET /v1/config` needs no sign-in and holds the price table, flags, the minimum native version and the voice pack (`packages/contracts/src/config.ts`). The app reads it on launch and when it comes back to the front, at most every 10 minutes, and keeps the last good copy in the `settings` table so prices show offline.
- The native version is `expo.version` in `app.json` (`docs/architecture.md` section 2), read with `Constants.expoConfig.version` from `expo-constants` (already a dependency).
- **"Update Waypoint" does not lock the app.** Notes, recording, pages, flashcards and search are on the phone and keep working with an old build; only the cloud may not. So the screen opens once per launch and can be closed, and M27a's `requireApprovedDevice()` opens it again before any cloud task. (Owner decision, see "Questions": a hard block is a one-line change.)

`apps/mobile/package.json`: add `"@waypoint/api-client": "0.0.0"` to `dependencies` (keep the list sorted).

`src/platform/api.ts`, exactly (checked here: type-checks and bundles):

```ts
import { getClerkInstance } from "@clerk/expo";
import { createApiClient, type DeviceSigner } from "@waypoint/api-client";
import { randomUUID } from "expo-crypto";
import { fetch } from "expo/fetch";

const baseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? "";
let device: DeviceSigner | null = null;

// Set by src/platform/device.ts (M27a) once this iPhone is registered and approved.
export function setDeviceSigner(signer: DeviceSigner | null): void {
  device = signer;
}

export const api = createApiClient({
  baseUrl,
  fetch: (url, init) => fetch(url, init),
  getToken: async () => (await getClerkInstance().session?.getToken()) ?? null,
  device: () => device,
  now: Date.now,
  newKey: randomUUID,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
```

`src/core/config/config.ts`, exactly:

```ts
import { ConfigResponseSchema, type ConfigResponse } from "@waypoint/contracts";

// How long a fetched config is used before the app asks again (on launch and when it comes back to the front).
export const CONFIG_MAX_AGE_MS = 10 * 60 * 1000;

// "1.4" or "1.4.2" → [1, 4, 2]. Anything else → null.
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

// True when this build is older than the oldest build the server supports. A version that cannot be read never
// blocks anything.
export function needsUpdate(native: string | null, minNative: string): boolean {
  const have = native === null ? null : parseVersion(native);
  const need = parseVersion(minNative);
  if (have === null || need === null) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function isStale(fetchedAt: number | null, now: number): boolean {
  return fetchedAt === null || now - fetchedAt >= CONFIG_MAX_AGE_MS || now < fetchedAt;
}

// The cached config from the settings table, or null when it is missing or does not match the contract.
export function parseCachedConfig(text: string | null): ConfigResponse | null {
  if (text === null) return null;
  try {
    const parsed = ConfigResponseSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Credits for a price key in the live price table ("explain", "more_detail", ...), or null when unknown.
export function priceOf(config: ConfigResponse | null, key: string): number | null {
  if (config === null || !Object.hasOwn(config.prices.credits, key)) return null;
  return config.prices.credits[key] ?? null;
}

// "1 credit", "3 credits", "2,000 credits".
export function creditsLabel(credits: number): string {
  const digits = String(credits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${digits} ${credits === 1 ? "credit" : "credits"}`;
}
```

`src/platform/config.ts`, exactly:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import type { ConfigResponse } from "@waypoint/contracts";
import { isStale, needsUpdate, parseCachedConfig } from "../core/config/config.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";

const CACHE_KEY = "config_cache";
const FETCHED_KEY = "config_fetched_at";

let loaded = false;
let current: ConfigResponse | null = null;
let fetchedAt: number | null = null;
let refreshing = false;
let updateShown = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  const db = getDb();
  current = parseCachedConfig(getSetting(db, CACHE_KEY));
  const at = getSetting(db, FETCHED_KEY);
  fetchedAt = current === null || at === null ? null : Number(at);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConfig(): ConfigResponse | null {
  load();
  return current;
}

// The native version is expo.version in app.json, built into the binary (docs/architecture.md section 2).
export function nativeVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

export function isUpdateRequired(): boolean {
  const config = getConfig();
  return config !== null && needsUpdate(nativeVersion(), config.min_native.ios);
}

// Fetches GET /v1/config when the cached copy is older than CONFIG_MAX_AGE_MS. Offline keeps the cached copy.
export async function refreshConfig(): Promise<void> {
  load();
  if (refreshing || !isStale(fetchedAt, Date.now())) return;
  refreshing = true;
  try {
    const config = await api.config();
    const now = Date.now();
    writeDb((db) => {
      setSetting(db, CACHE_KEY, JSON.stringify(config));
      setSetting(db, FETCHED_KEY, String(now));
    });
    current = config;
    fetchedAt = now;
    for (const listener of listeners) listener();
  } catch {
    // Keep the cached config; the next launch or return to the app tries again.
  } finally {
    refreshing = false;
  }
}

export function useConfig(): ConfigResponse | null {
  return useSyncExternalStore(subscribe, getConfig);
}

export function useUpdateRequired(): boolean {
  return useSyncExternalStore(subscribe, isUpdateRequired);
}

// Called once in (tabs)/_layout.tsx: refreshes on launch and whenever the app comes back to the front, and opens
// "Update Waypoint" once per launch when this build is too old.
export function useConfigRefresh(): void {
  const updateRequired = useUpdateRequired();
  useEffect(() => {
    void refreshConfig();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshConfig();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (updateRequired && !updateShown) {
      updateShown = true;
      router.push("/update");
    }
  }, [updateRequired]);
}
```

`src/shell/UpdateScreen.tsx`, exactly (copy written for this card; check it against the boards). "Open the App Store" shows only when `EXPO_PUBLIC_APP_STORE_ID` is set to the app's numeric id:

```tsx
import { Linking, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Body, OnDeviceNote, PrimaryButton, Screen, SecondaryButton, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

const appStoreId = process.env.EXPO_PUBLIC_APP_STORE_ID ?? "";

export default function UpdateScreen() {
  const colors = useColors();
  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name="arrow.down.app" tintColor={colors.accent} size={44} />
      </View>
      <Title>Update Waypoint</Title>
      <Body>This version of Waypoint is too old for the cloud. Update it from the App Store to keep using Explain and credits.</Body>
      <OnDeviceNote text="Everything on this iPhone keeps working: your notes, recording, pages, flashcards and search." />
      {/^\d+$/.test(appStoreId) ? <PrimaryButton label="Open the App Store" onPress={() => void Linking.openURL(`itms-apps://apps.apple.com/app/id${appStoreId}`)} /> : null}
      <SecondaryButton label="Not now" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ badge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" } });
```

`src/app/update.tsx` only re-exports the screen. `src/app/_layout.tsx`: inside the signed-in `Stack.Protected`, add `<Stack.Screen name="update" options={{ presentation: "modal" }} />`. `src/app/(tabs)/_layout.tsx`: call `useConfigRefresh()` next to the other hooks.

`test/config.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { creditsLabel, isStale, needsUpdate, parseCachedConfig, parseVersion, priceOf, CONFIG_MAX_AGE_MS } from "../src/core/config/config.ts";

const CONFIG = { prices: { version: "2026-11-16.2", credits: { explain: 1, more_detail: 3 } }, routes_version: "r1", flags: {}, min_native: { ios: "0.2.0" }, voice_pack: { version: "1", url: "https://x.test/p", sha256: "a".repeat(64), size: 1 } };

describe("config", () => {
  it("versions", () => {
    expect(parseVersion("1.4")).toEqual([1, 4, 0]);
    expect(parseVersion(" 1.4.2 ")).toEqual([1, 4, 2]);
    for (const bad of ["1", "1.4.2.1", "v1.4", "", "1.a"]) expect(parseVersion(bad)).toBeNull();
    expect(needsUpdate("0.1.0", "0.2.0")).toBe(true);
    expect(needsUpdate("0.2.0", "0.2")).toBe(false);
    expect(needsUpdate("1.10.0", "1.9.9")).toBe(false);
    expect(needsUpdate("1.9.9", "1.10.0")).toBe(true);
    expect(needsUpdate(null, "9.9.9")).toBe(false);
    expect(needsUpdate("1.0.0", "soon")).toBe(false);
  });
  it("stale", () => {
    expect(isStale(null, 5)).toBe(true);
    expect(isStale(1000, 1000 + CONFIG_MAX_AGE_MS - 1)).toBe(false);
    expect(isStale(1000, 1000 + CONFIG_MAX_AGE_MS)).toBe(true);
    expect(isStale(1000, 999)).toBe(true);
  });
  it("cache, price, label", () => {
    expect(parseCachedConfig(JSON.stringify(CONFIG))).toEqual(CONFIG);
    expect(parseCachedConfig("{")).toBeNull();
    expect(parseCachedConfig(JSON.stringify({ ...CONFIG, extra: 1 }))).toBeNull();
    expect(parseCachedConfig(null)).toBeNull();
    const c = parseCachedConfig(JSON.stringify(CONFIG));
    expect(priceOf(c, "more_detail")).toBe(3);
    expect(priceOf(c, "toString")).toBeNull();
    expect(priceOf(null, "explain")).toBeNull();
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(3)).toBe("3 credits");
    expect(creditsLabel(20000)).toBe("20,000 credits");
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (needs Xcode, `EXPO_PUBLIC_API_URL` pointing at a running API with KV config):
1. Launch signed in with the network on, then turn on Airplane Mode and relaunch: no error and no "Update Waypoint" (the cached config is used).
2. Set `config:min-native` in KV to `{"ios":"9.0.0"}`: on the next launch "Update Waypoint" opens once; "Not now" closes it; it does not open again until the next launch. Put the value back.

Not in this PR: flags used by any screen, the voice pack (stage 3), blocking the whole app on an old build, Zephyr's own version check (M2).

---

### M26a · Native crypto logic (`KeysCore`), passing every published vector

Branch `pr/m26a-keys-core`. After M5 (merged; it made `modules/Package.swift`). No npm dependencies. Files, all under `apps/mobile/modules/`: `Package.swift` (two lines), `waypoint-keys/ios/Core/Bytes.swift`, `Core/Keys.swift`, `Core/Signing.swift`, `Core/Envelope.swift`, `Core/Locked.swift`, `waypoint-keys/ios/Tests/Vectors.swift`, `Tests/VectorTests.swift`. Nothing else: the module around it is M26b.

Why it looks like this:
- `docs/security.md` section 19 lists what the iOS side must do and the vectors it must pass. This card is the format code for all of it, written on CryptoKit only (no other library; owner decision of 19 Nov 2026), as plain Swift that `swift test` runs on this Mac with the Command Line Tools: base64url, `context()`, request signing input and signatures, pairing commitment and 6-digit code, device certificates, both envelope purposes (make, parse, verify, open), sealed job results, the recovery wrap key and blob, and locked content.
- HPKE is CryptoKit's `HPKE.Sender` / `HPKE.Recipient` with `.P256_SHA256_AES_GCM_256` (RFC 9180 base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM). The open functions are generic over `HPKEDiffieHellmanPrivateKey`, which both `P256.KeyAgreement.PrivateKey` (tests, the account key) and `SecureEnclave.P256.KeyAgreement.PrivateKey` (the phone) conform to (checked in the SDK's CryptoKit interface).
- CryptoKit cannot set HPKE's ephemeral key, so iOS checks HPKE by **opening** the vectors' envelopes and sealed result, and by a round trip with its own seal, not by sealing to the same bytes (`docs/security.md` section 19).
- The tests read the vectors where `packages/crypto` publishes them (`packages/crypto/test/vectors/`), by a path relative to the test file, so there is one copy.
- This `Core` folder imports Foundation and CryptoKit (stage 2 rule 7).
- Not here: BIP-39 words and the Trezor vectors (M27b, with the recovery key screens), and the link passcode (server only: it needs the server's pepper).

**Proved here, 19 Nov 2026, on this Mac (macOS 15.7.3, Swift 6.1.2, Command Line Tools only):** with exactly the files below, `npm run test:swift -w @waypoint/mobile` ran the 16 Keys tests below (29 with the existing Audio and Pages tests) and all passed, with no compiler warnings: every deterministic byte string in `waypoint-v1.json` (context, request signing input, pairing commitment and code, certificate input, both envelopes' HPKE info and signature input, sealed-result info, recovery wrap key, AAD and blob, content context and locked bytes); every given signature verifies and fails when one field changes; both envelopes and the sealed result open with the given private keys and fail with a wrong context; our own envelope and certificate round-trip; the RFC 9180 vector opens with `skRm` and `pkRm` matches; all 262 Wycheproof `ecdsa_secp256r1_sha256_p1363` cases give the expected answer (173 valid, 89 invalid).

`modules/Package.swift`: add these two lines at the end of `targets`, after the `PagesCoreTests` line:

```swift
    .target(name: "KeysCore", path: "waypoint-keys/ios/Core"),
    .testTarget(name: "KeysCoreTests", dependencies: ["KeysCore"], path: "waypoint-keys/ios/Tests"),
```

`waypoint-keys/ios/Core/Bytes.swift`, exactly:

```swift
import CryptoKit
import Foundation

// Every way a Waypoint format can be refused. JavaScript sees the case name as error.code (see WaypointKeysModule).
public enum KeysError: Error, Equatable {
  case badBase64URL, badHex, badLabel, badId, badPublicKey, badSignature, badNonce, badInput
  case badEnvelope, badSealed, badRecovery, badContent
}

// Base64url without padding (docs/security.md section 4). Decoding is strict: no padding, no "+/", and the text
// must be the canonical encoding of its bytes.
public enum Base64URL {
  public static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  public static func decode(_ text: String) throws -> Data {
    let ok = text.utf8.allSatisfy { c in
      (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f
    }
    guard ok, text.utf8.count % 4 != 1 else { throw KeysError.badBase64URL }
    var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    b64 += String(repeating: "=", count: (4 - b64.utf8.count % 4) % 4)
    guard let data = Data(base64Encoded: b64), encode(data) == text else { throw KeysError.badBase64URL }
    return data
  }
}

extension Data {
  public var hex: String { map { String(format: "%02x", $0) }.joined() }

  // Lowercase hex only, as in the test vectors.
  public init(hex text: String) throws {
    guard text.utf8.count % 2 == 0, text.utf8.allSatisfy({ ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }) else {
      throw KeysError.badHex
    }
    var out = Data(capacity: text.utf8.count / 2)
    var index = text.startIndex
    while index < text.endIndex {
      let next = text.index(index, offsetBy: 2)
      out.append(UInt8(text[index..<next], radix: 16)!)
      index = next
    }
    self = out
  }
}

func u16(_ value: Int) throws -> Data {
  guard value >= 0, value <= 0xffff else { throw KeysError.badInput }
  return Data([UInt8(value >> 8), UInt8(value & 0xff)])
}

func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

// Random bytes from the system generator (CryptoKit's SymmetricKey uses it).
public func randomBytes(_ count: Int) -> Data {
  SymmetricKey(size: SymmetricKeySize(bitCount: count * 8)).withUnsafeBytes { Data($0) }
}

// Ids inside signed or encrypted context: ^[A-Za-z0-9_-]{1,64}$.
@discardableResult
public func checkId(_ id: String) throws -> String {
  let ok = (1...64).contains(id.utf8.count) && id.utf8.allSatisfy { c in
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f
  }
  guard ok else { throw KeysError.badId }
  return id
}

// context(label, f1, f2, ...) = "waypoint/v1/" ‖ label ‖ 0x00 ‖ u16(len f1) ‖ f1 ‖ ... (docs/security.md section 4).
public func context(_ label: String, _ fields: [String]) throws -> Data {
  let labelOk = (1...32).contains(label.utf8.count) && label.utf8.allSatisfy { c in
    (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d
  }
  guard labelOk else { throw KeysError.badLabel }
  var out = Data("waypoint/v1/\(label)".utf8)
  out.append(0)
  for field in fields {
    let bytes = Data(field.utf8)
    out.append(try u16(bytes.count))
    out.append(bytes)
  }
  return out
}
```

`Core/Keys.swift`, exactly:

```swift
import CryptoKit
import Foundation

// Public keys travel as base64url of the 65-byte SEC1 point 04 ‖ X ‖ Y (x963Representation); signatures as the
// 64-byte r ‖ s (rawRepresentation).
public enum PublicKeys {
  // Length and prefix only, like the server's decodePublicKey (used inside contexts).
  public static func raw(_ text: String) throws -> Data {
    let bytes = try Base64URL.decode(text)
    guard bytes.count == 65, bytes.first == 0x04 else { throw KeysError.badPublicKey }
    return bytes
  }

  // Also checks the point is on the curve.
  public static func signing(_ text: String) throws -> P256.Signing.PublicKey {
    do { return try P256.Signing.PublicKey(x963Representation: try raw(text)) } catch { throw KeysError.badPublicKey }
  }

  public static func box(_ text: String) throws -> P256.KeyAgreement.PublicKey {
    do { return try P256.KeyAgreement.PublicKey(x963Representation: try raw(text)) } catch { throw KeysError.badPublicKey }
  }
}

// A P-256 signing key: the Secure Enclave key on the phone, a software key in tests and for the account key.
public protocol SigningKey {
  var publicKeyText: String { get }
  func sign(_ message: Data) throws -> Data // 64 bytes, r ‖ s
}

extension P256.Signing.PrivateKey: SigningKey {
  public var publicKeyText: String { Base64URL.encode(publicKey.x963Representation) }
  public func sign(_ message: Data) throws -> Data { try signature(for: message).rawRepresentation }
}

extension SecureEnclave.P256.Signing.PrivateKey: SigningKey {
  public var publicKeyText: String { Base64URL.encode(publicKey.x963Representation) }
  public func sign(_ message: Data) throws -> Data { try signature(for: message).rawRepresentation }
}

public func boxKeyText(_ key: P256.KeyAgreement.PublicKey) -> String { Base64URL.encode(key.x963Representation) }

// ECDSA P-256 / SHA-256 over message; false for any malformed input.
public func verifyP256(_ publicKey: P256.Signing.PublicKey, signature: Data, message: Data) -> Bool {
  guard signature.count == 64, let sig = try? P256.Signing.ECDSASignature(rawRepresentation: signature) else { return false }
  return publicKey.isValidSignature(sig, for: message)
}
```

`Core/Signing.swift`, exactly:

```swift
import CryptoKit
import Foundation

// Request signatures (docs/security.md section 7).
public enum RequestSigning {
  public static let newDevice = "new" // Waypoint-Device while registering (POST /v1/devices)

  public static func bodySha256Hex(_ body: Data) -> String { sha256(body).hex }

  public static func input(method: String, target: String, deviceId: String, timestamp: Int64, nonce: String, bodySha256Hex: String) throws -> Data {
    let methodOk = (3...7).contains(method.utf8.count) && method.utf8.allSatisfy { $0 >= 0x41 && $0 <= 0x5a }
    let targetOk = target.first == "/" && target.utf8.count <= 2048 && target.utf8.allSatisfy { $0 >= 0x21 && $0 <= 0x7e }
    let hashOk = bodySha256Hex.utf8.count == 64 && bodySha256Hex.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    guard methodOk, targetOk, hashOk, timestamp >= 0 else { throw KeysError.badInput }
    if deviceId != newDevice { try checkId(deviceId) }
    guard nonce.utf8.count == 22, (try? Base64URL.decode(nonce))?.count == 16 else { throw KeysError.badNonce }
    return try context("request", [method, target, deviceId, String(timestamp), nonce, bodySha256Hex])
  }

  // A new 16-byte nonce on every call, including retries of the same request.
  public static func sign(_ key: some SigningKey, method: String, target: String, deviceId: String, timestamp: Int64, body: Data) throws -> (nonce: String, signature: String) {
    let nonce = Base64URL.encode(randomBytes(16))
    let message = try input(method: method, target: target, deviceId: deviceId, timestamp: timestamp, nonce: nonce, bodySha256Hex: bodySha256Hex(body))
    return (nonce, Base64URL.encode(try key.sign(message)))
  }
}

// Adding a device (docs/security.md section 8). Keys and nonces are base64url text.
public enum Pairing {
  public static func newNonce() -> String { Base64URL.encode(randomBytes(32)) }

  static func checkNonce(_ nonce: String) throws -> String {
    guard (try? Base64URL.decode(nonce))?.count == 32 else { throw KeysError.badNonce }
    return nonce
  }

  public static func commitment(signPub: String, boxPub: String, newNonce: String) throws -> String {
    _ = try PublicKeys.raw(signPub)
    _ = try PublicKeys.raw(boxPub)
    return Base64URL.encode(sha256(try context("pair-commit", [signPub, boxPub, try checkNonce(newNonce)])))
  }

  // First 4 bytes of the hash, big-endian, mod 1,000,000, as 6 digits.
  public static func code(newSignPub: String, newBoxPub: String, approverSignPub: String, approverNonce: String, newNonce: String) throws -> String {
    for key in [newSignPub, newBoxPub, approverSignPub] { _ = try PublicKeys.raw(key) }
    let digest = sha256(try context("pair-code", [newSignPub, newBoxPub, approverSignPub, try checkNonce(approverNonce), try checkNonce(newNonce)]))
    let value = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    let code = String(value % 1_000_000)
    return String(repeating: "0", count: 6 - code.count) + code
  }
}

// The account key's signature over a device's keys (docs/security.md section 6).
public enum DeviceCertificate {
  public static func input(userId: String, deviceId: String, signPub: String, boxPub: String) throws -> Data {
    _ = try PublicKeys.raw(signPub)
    _ = try PublicKeys.raw(boxPub)
    return try context("device-cert", [try checkId(userId), try checkId(deviceId), signPub, boxPub])
  }

  public static func sign(_ accountKey: some SigningKey, userId: String, deviceId: String, signPub: String, boxPub: String) throws -> String {
    Base64URL.encode(try accountKey.sign(try input(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)))
  }

  public static func verify(accountSignPub: String, cert: String, userId: String, deviceId: String, signPub: String, boxPub: String) -> Bool {
    guard let key = try? PublicKeys.signing(accountSignPub), let sig = try? Base64URL.decode(cert),
      let message = try? input(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)
    else { return false }
    return verifyP256(key, signature: sig, message: message)
  }
}
```

`Core/Envelope.swift`, exactly:

```swift
import CryptoKit
import Foundation

// HPKE base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM (docs/security.md section 3).
let suite = HPKE.Ciphersuite.P256_SHA256_AES_GCM_256

// A key wrapped for one device and signed by the device that wrapped it (docs/security.md section 9):
//   u8 version 1 | u8 purpose | enc (65) | u16 ct length | ct | u8 signer length | signer id | signature (64)
public enum Envelope {
  public enum Purpose: UInt8 {
    case groupKey = 1, accountKey = 2
    var keyBytes: Int { self == .groupKey ? 32 : 64 }
  }

  public struct Parsed: Equatable {
    public let purpose: Purpose
    public let enc: Data
    public let ct: Data
    public let signerId: String
    public let signature: Data
    public let body: Data // every byte before the signature
  }

  public static func groupKeyInfo(groupId: String, keyVersion: Int, deviceId: String) throws -> Data {
    guard keyVersion >= 1 else { throw KeysError.badInput }
    return try context("group-key", [try checkId(groupId), String(keyVersion), try checkId(deviceId)])
  }

  public static func accountKeyInfo(userId: String, accountDeviceId: String, deviceId: String) throws -> Data {
    try context("account-key", [try checkId(userId), try checkId(accountDeviceId), try checkId(deviceId)])
  }

  public static func signatureInput(info: Data, body: Data) throws -> Data {
    var out = try context("envelope-sig", [])
    out.append(try u16(info.count))
    out.append(info)
    out.append(body)
    return out
  }

  public static func parse(_ bytes: Data) throws -> Parsed {
    let b = [UInt8](bytes)
    guard b.count >= 2 + 65 + 2, b[0] == 1, let purpose = Purpose(rawValue: b[1]) else { throw KeysError.badEnvelope }
    var at = 2
    let enc = Data(b[at..<at + 65])
    at += 65
    let ctLength = Int(b[at]) << 8 | Int(b[at + 1])
    at += 2
    guard enc.first == 0x04, ctLength == purpose.keyBytes + 16, b.count > at + ctLength else { throw KeysError.badEnvelope }
    let ct = Data(b[at..<at + ctLength])
    at += ctLength
    let signerLength = Int(b[at])
    at += 1
    guard b.count == at + signerLength + 64, let signerId = String(bytes: b[at..<at + signerLength], encoding: .utf8),
      (try? checkId(signerId)) != nil
    else { throw KeysError.badEnvelope }
    at += signerLength
    return Parsed(purpose: purpose, enc: enc, ct: ct, signerId: signerId, signature: Data(b[at...]), body: Data(b[..<at]))
  }

  public static func make(purpose: Purpose, info: Data, recipientBoxPub: P256.KeyAgreement.PublicKey, key: Data, signerId: String, signer: some SigningKey) throws -> Data {
    guard key.count == purpose.keyBytes else { throw KeysError.badInput }
    let header = Data([1, purpose.rawValue])
    var sender = try HPKE.Sender(recipientKey: recipientBoxPub, ciphersuite: suite, info: info)
    let ct = try sender.seal(key, authenticating: header)
    let signer8 = Data(try checkId(signerId).utf8)
    var body = header
    body.append(sender.encapsulatedKey)
    body.append(try u16(ct.count))
    body.append(ct)
    body.append(UInt8(signer8.count))
    body.append(signer8)
    let signature = try signer.sign(try signatureInput(info: info, body: body))
    return body + signature
  }

  // The signature only; the caller also checks the signer's certificate (docs/security.md section 6).
  public static func verify(_ envelope: Parsed, info: Data, signerSignPub: P256.Signing.PublicKey) -> Bool {
    guard let message = try? signatureInput(info: info, body: envelope.body) else { return false }
    return verifyP256(signerSignPub, signature: envelope.signature, message: message)
  }

  // Works with a software key and with SecureEnclave.P256.KeyAgreement.PrivateKey.
  public static func open<K: HPKEDiffieHellmanPrivateKey>(_ envelope: Parsed, info: Data, recipient: K) throws -> Data {
    do {
      var r = try HPKE.Recipient(privateKey: recipient, ciphersuite: suite, info: info, encapsulatedKey: envelope.enc)
      return try r.open(envelope.ct, authenticating: Data([1, envelope.purpose.rawValue]))
    } catch {
      throw KeysError.badEnvelope
    }
  }
}

// A job result sealed to this device (docs/security.md section 14): u8 1 | u8 3 | enc (65) | ct.
public enum SealedResult {
  public static func info(jobId: String, deviceId: String) throws -> Data {
    try context("result", [try checkId(jobId), try checkId(deviceId)])
  }

  public static func open<K: HPKEDiffieHellmanPrivateKey>(_ sealed: Data, jobId: String, deviceId: String, recipient: K) throws -> Data {
    let b = [UInt8](sealed)
    guard b.count >= 2 + 65 + 16, b[0] == 1, b[1] == 3 else { throw KeysError.badSealed }
    do {
      var r = try HPKE.Recipient(privateKey: recipient, ciphersuite: suite, info: try info(jobId: jobId, deviceId: deviceId), encapsulatedKey: Data(b[2..<67]))
      return try r.open(Data(b[67...]), authenticating: Data([1, 3]))
    } catch {
      throw KeysError.badSealed
    }
  }
}
```

`Core/Locked.swift`, exactly:

```swift
import CryptoKit
import Foundation

// The recovery blob (docs/security.md section 13): u8 1 | nonce (12) | AES-256-GCM(account key, 64 B) ‖ tag (16) = 93 bytes.
public enum Recovery {
  public static func wrapKey(entropy: Data, userId: String) throws -> SymmetricKey {
    guard entropy.count == 16 else { throw KeysError.badRecovery }
    return HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: entropy), salt: Data(), info: try context("recovery-key", [try checkId(userId)]), outputByteCount: 32)
  }

  public static func aad(userId: String, accountDeviceId: String) throws -> Data {
    Data([1]) + (try context("recovery", [try checkId(userId), try checkId(accountDeviceId)]))
  }

  public static func wrap(accountKey: Data, wrapKey: SymmetricKey, userId: String, accountDeviceId: String, nonce: Data = randomBytes(12)) throws -> Data {
    guard accountKey.count == 64, nonce.count == 12 else { throw KeysError.badRecovery }
    let box = try AES.GCM.seal(accountKey, using: wrapKey, nonce: try AES.GCM.Nonce(data: nonce), authenticating: try aad(userId: userId, accountDeviceId: accountDeviceId))
    return Data([1]) + nonce + box.ciphertext + box.tag
  }

  public static func unwrap(_ blob: Data, wrapKey: SymmetricKey, userId: String, accountDeviceId: String) throws -> Data {
    let b = [UInt8](blob)
    guard b.count == 93, b[0] == 1 else { throw KeysError.badRecovery }
    do {
      let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: Data(b[1..<13])), ciphertext: Data(b[13..<77]), tag: Data(b[77...]))
      return try AES.GCM.open(box, using: wrapKey, authenticating: try aad(userId: userId, accountDeviceId: accountDeviceId))
    } catch {
      throw KeysError.badRecovery
    }
  }
}

// Locked content (docs/security.md section 11): u8 1 | u32 key version | nonce (12) | ciphertext ‖ tag;
// AAD = the 17 header bytes ‖ the object's context.
public enum LockedContent {
  static func header(keyVersion: UInt32, nonce: Data) -> Data {
    Data([1, UInt8(keyVersion >> 24), UInt8(keyVersion >> 16 & 0xff), UInt8(keyVersion >> 8 & 0xff), UInt8(keyVersion & 0xff)]) + nonce
  }

  public static func lock(key: SymmetricKey, keyVersion: UInt32, objectContext: Data, plaintext: Data, nonce: Data = randomBytes(12)) throws -> Data {
    guard key.bitCount == 256, nonce.count == 12 else { throw KeysError.badContent }
    let head = header(keyVersion: keyVersion, nonce: nonce)
    let box = try AES.GCM.seal(plaintext, using: key, nonce: try AES.GCM.Nonce(data: nonce), authenticating: head + objectContext)
    return head + box.ciphertext + box.tag
  }

  public static func keyVersion(_ locked: Data) throws -> UInt32 {
    let b = [UInt8](locked)
    guard b.count >= 17 + 16, b[0] == 1 else { throw KeysError.badContent }
    return b[1...4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
  }

  public static func unlock(key: SymmetricKey, objectContext: Data, locked: Data) throws -> Data {
    _ = try keyVersion(locked)
    let b = [UInt8](locked)
    do {
      let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: Data(b[5..<17])), ciphertext: Data(b[17..<(b.count - 16)]), tag: Data(b[(b.count - 16)...]))
      return try AES.GCM.open(box, using: key, authenticating: Data(b[0..<17]) + objectContext)
    } catch {
      throw KeysError.badContent
    }
  }
}
```

`waypoint-keys/ios/Tests/Vectors.swift`, exactly:

```swift
import Foundation

// Reads the published vectors from packages/crypto/test/vectors (docs/security.md section 18). They are not copied.
func readVectors<T: Decodable>(_ name: String, as: T.Type) throws -> T {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() } // Tests, ios, waypoint-keys, modules, mobile, apps → repo root
  let file = url.appendingPathComponent("packages/crypto/test/vectors/\(name)")
  return try JSONDecoder().decode(T.self, from: try Data(contentsOf: file))
}

struct WaypointV1: Decodable {
  struct Context: Decodable { let label: String; let fields: [String]; let bytes: String }
  struct Request: Decodable {
    let method: String, target: String, deviceId: String, timestamp: Int64, nonce: String, bodySha256: String
    let body_utf8: String, signing_input: String, device_private_key: String, device_sign_pub: String, signature: String
  }
  struct PairingV: Decodable {
    let new_sign_pub: String, new_box_pub: String, new_nonce: String, approver_sign_pub: String, approver_nonce: String
    let commitment: String, code: String
  }
  struct Certificate: Decodable {
    let user_id: String, device_id: String, sign_pub: String, box_pub: String, signing_input: String
    let account_private_key: String, account_sign_pub: String, signature: String
  }
  struct GroupEnvelope: Decodable {
    let group_id: String, key_version: Int, recipient_device_id: String, recipient_private_key: String, recipient_box_pub: String
    let group_key: String, signer_id: String, signer_private_key: String, signer_sign_pub: String, info: String
    let signature_input: String, envelope: String
  }
  struct AccountEnvelope: Decodable {
    let user_id: String, account_device_id: String, recipient_device_id: String, recipient_private_key: String
    let account_key: String, signer_id: String, signer_sign_pub: String, info: String, envelope: String
  }
  struct Sealed: Decodable {
    let job_id: String, device_id: String, device_private_key: String, device_box_pub: String, info: String
    let plaintext_utf8: String, sealed: String
  }
  struct RecoveryV: Decodable {
    let entropy: String, user_id: String, account_device_id: String, wrap_key: String, aad: String
    let account_key: String, nonce: String, blob: String
  }
  struct Content: Decodable {
    let key: String, key_version: UInt32, context: String, context_label: String, context_fields: [String]
    let nonce: String, plaintext_utf8: String, locked: String
  }
  let context: Context
  let request: Request
  let pairing: PairingV
  let device_certificate: Certificate
  let group_key_envelope: GroupEnvelope
  let account_key_envelope: AccountEnvelope
  let sealed_result: Sealed
  let recovery: RecoveryV
  let content: Content
}

struct Rfc9180: Decodable {
  struct Encryption: Decodable { let aad: String; let ct: String; let pt: String }
  let info: String, skRm: String, pkRm: String, enc: String
  let encryptions: [Encryption]
}

struct Wycheproof: Decodable {
  struct Group: Decodable {
    struct Key: Decodable { let uncompressed: String }
    struct Case: Decodable { let tcId: Int; let msg: String; let sig: String; let result: String }
    let publicKey: Key
    let tests: [Case]
  }
  let numberOfTests: Int
  let testGroups: [Group]
}
```

`Tests/VectorTests.swift`, exactly:

```swift
import CryptoKit
import Foundation
import Testing
@testable import KeysCore

private let v = try! readVectors("waypoint-v1.json", as: WaypointV1.self)

private func b64(_ text: String) -> Data { try! Base64URL.decode(text) }
private func boxKey(_ hex: String) -> P256.KeyAgreement.PrivateKey { try! P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: hex)) }
private func signKey(_ hex: String) -> P256.Signing.PrivateKey { try! P256.Signing.PrivateKey(rawRepresentation: Data(hex: hex)) }

@Test func contextMatchesTheVector() throws {
  #expect(try context(v.context.label, v.context.fields).hex == v.context.bytes)
}

@Test func requestSigningInputAndSignature() throws {
  let r = v.request
  #expect(RequestSigning.bodySha256Hex(Data(r.body_utf8.utf8)) == r.bodySha256)
  let input = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, nonce: r.nonce, bodySha256Hex: r.bodySha256)
  #expect(input.hex == r.signing_input)
  let pub = try PublicKeys.signing(r.device_sign_pub)
  #expect(verifyP256(pub, signature: b64(r.signature), message: input))
  let later = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp + 1, nonce: r.nonce, bodySha256Hex: r.bodySha256)
  #expect(!verifyP256(pub, signature: b64(r.signature), message: later))
  // The vector's private key is the key whose public half is device_sign_pub; our own signature verifies too.
  let key = signKey(r.device_private_key)
  #expect(key.publicKeyText == r.device_sign_pub)
  let signed = try RequestSigning.sign(key, method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: Data(r.body_utf8.utf8))
  let again = try RequestSigning.sign(key, method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: Data(r.body_utf8.utf8))
  #expect(signed.nonce != again.nonce)
  let ours = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, nonce: signed.nonce, bodySha256Hex: r.bodySha256)
  #expect(verifyP256(pub, signature: b64(signed.signature), message: ours))
}

@Test func requestSigningInputRefusesBadFields() {
  let r = v.request
  let bad: [(String, String, String, Int64, String, String)] = [
    ("post", r.target, r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, "v1/x", r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, "/v1/a b", r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, r.target, "dev phone", r.timestamp, r.nonce, r.bodySha256),
    (r.method, r.target, r.deviceId, -1, r.nonce, r.bodySha256),
    (r.method, r.target, r.deviceId, r.timestamp, "AQID", r.bodySha256),
    (r.method, r.target, r.deviceId, r.timestamp, r.nonce, String(r.bodySha256.dropLast())),
  ]
  for b in bad {
    #expect(throws: KeysError.self) { try RequestSigning.input(method: b.0, target: b.1, deviceId: b.2, timestamp: b.3, nonce: b.4, bodySha256Hex: b.5) }
  }
  #expect(throws: Never.self) { try RequestSigning.input(method: "POST", target: "/v1/devices", deviceId: "new", timestamp: 0, nonce: r.nonce, bodySha256Hex: r.bodySha256) }
}

@Test func pairingCommitmentAndCode() throws {
  let p = v.pairing
  #expect(try Pairing.commitment(signPub: p.new_sign_pub, boxPub: p.new_box_pub, newNonce: p.new_nonce) == p.commitment)
  #expect(try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.approver_nonce, newNonce: p.new_nonce) == p.code)
  #expect(try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.new_nonce, newNonce: p.approver_nonce) != p.code)
  #expect(b64(Pairing.newNonce()).count == 32)
}

@Test func deviceCertificate() throws {
  let c = v.device_certificate
  #expect(try DeviceCertificate.input(userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub).hex == c.signing_input)
  #expect(DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: c.signature, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
  #expect(!DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: c.signature, userId: "usr_2", deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
  let account = signKey(c.account_private_key)
  #expect(account.publicKeyText == c.account_sign_pub)
  let cert = try DeviceCertificate.sign(account, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub)
  #expect(DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: cert, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
}

@Test func groupKeyEnvelopeOpensAndVerifies() throws {
  let g = v.group_key_envelope
  let info = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version, deviceId: g.recipient_device_id)
  #expect(info.hex == g.info)
  let parsed = try Envelope.parse(b64(g.envelope))
  #expect(parsed.purpose == .groupKey && parsed.signerId == g.signer_id)
  #expect(try Envelope.signatureInput(info: info, body: parsed.body).hex == g.signature_input)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(g.recipient_private_key)).hex == g.group_key)
  // Another version or another recipient does not open, and does not verify.
  let other = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version + 1, deviceId: g.recipient_device_id)
  #expect(throws: KeysError.badEnvelope) { try Envelope.open(parsed, info: other, recipient: boxKey(g.recipient_private_key)) }
  #expect(!Envelope.verify(parsed, info: other, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
}

@Test func accountKeyEnvelopeOpensAndVerifies() throws {
  let a = v.account_key_envelope
  let info = try Envelope.accountKeyInfo(userId: a.user_id, accountDeviceId: a.account_device_id, deviceId: a.recipient_device_id)
  #expect(info.hex == a.info)
  let parsed = try Envelope.parse(b64(a.envelope))
  #expect(parsed.purpose == .accountKey)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(a.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(a.recipient_private_key)).hex == a.account_key)
}

@Test func envelopeRoundTripWithOurOwnSeal() throws {
  let g = v.group_key_envelope
  let info = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version, deviceId: g.recipient_device_id)
  let signer = signKey(g.signer_private_key)
  let made = try Envelope.make(purpose: .groupKey, info: info, recipientBoxPub: try PublicKeys.box(g.recipient_box_pub), key: Data(hex: g.group_key), signerId: g.signer_id, signer: signer)
  let parsed = try Envelope.parse(made)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(g.recipient_private_key)).hex == g.group_key)
  #expect(throws: KeysError.badInput) {
    try Envelope.make(purpose: .accountKey, info: info, recipientBoxPub: try PublicKeys.box(g.recipient_box_pub), key: Data(hex: g.group_key), signerId: g.signer_id, signer: signer)
  }
}

@Test func envelopeParseRefusesBadShapes() throws {
  let bytes = b64(v.group_key_envelope.envelope)
  var wrongVersion = bytes; wrongVersion[0] = 2
  var wrongPurpose = bytes; wrongPurpose[1] = 3
  for bad in [wrongVersion, wrongPurpose, bytes.dropLast(), bytes + Data([0]), Data(bytes.prefix(60))] {
    #expect(throws: KeysError.badEnvelope) { try Envelope.parse(Data(bad)) }
  }
}

@Test func sealedResultOpens() throws {
  let s = v.sealed_result
  #expect(try SealedResult.info(jobId: s.job_id, deviceId: s.device_id).hex == s.info)
  let plain = try SealedResult.open(b64(s.sealed), jobId: s.job_id, deviceId: s.device_id, recipient: boxKey(s.device_private_key))
  #expect(String(decoding: plain, as: UTF8.self) == s.plaintext_utf8)
  #expect(throws: KeysError.badSealed) { try SealedResult.open(b64(s.sealed), jobId: "job_2", deviceId: s.device_id, recipient: boxKey(s.device_private_key)) }
}

@Test func recoveryWrapKeyAndBlob() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  #expect(wrapKey.withUnsafeBytes { Data($0) }.hex == r.wrap_key)
  #expect(try Recovery.aad(userId: r.user_id, accountDeviceId: r.account_device_id).hex == r.aad)
  let blob = try Recovery.wrap(accountKey: Data(hex: r.account_key), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, nonce: Data(hex: r.nonce))
  #expect(Base64URL.encode(blob) == r.blob)
  #expect(try Recovery.unwrap(b64(r.blob), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id).hex == r.account_key)
  #expect(throws: KeysError.badRecovery) { try Recovery.unwrap(b64(r.blob), wrapKey: wrapKey, userId: "usr_2", accountDeviceId: r.account_device_id) }
}

@Test func lockedContent() throws {
  let c = v.content
  let objectContext = try context(c.context_label, c.context_fields)
  #expect(objectContext.hex == c.context)
  let key = SymmetricKey(data: try Data(hex: c.key))
  let locked = try LockedContent.lock(key: key, keyVersion: c.key_version, objectContext: objectContext, plaintext: Data(c.plaintext_utf8.utf8), nonce: Data(hex: c.nonce))
  #expect(Base64URL.encode(locked) == c.locked)
  #expect(try LockedContent.keyVersion(locked) == c.key_version)
  #expect(String(decoding: try LockedContent.unlock(key: key, objectContext: objectContext, locked: locked), as: UTF8.self) == c.plaintext_utf8)
  let otherContext = try context(c.context_label, ["grp_2"] + c.context_fields.dropFirst())
  #expect(throws: KeysError.badContent) { try LockedContent.unlock(key: key, objectContext: otherContext, locked: locked) }
}

@Test func rfc9180VectorOpens() throws {
  let t = try readVectors("rfc9180-p256-sha256-aes256gcm-base.json", as: Rfc9180.self)
  let sk = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: t.skRm))
  #expect(sk.publicKey.x963Representation.hex == t.pkRm)
  var recipient = try HPKE.Recipient(privateKey: sk, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data(hex: t.info), encapsulatedKey: Data(hex: t.enc))
  let first = try #require(t.encryptions.first)
  #expect(try recipient.open(Data(hex: first.ct), authenticating: Data(hex: first.aad)).hex == first.pt)
}

@Test func wycheproofEcdsaP1363() throws {
  let w = try readVectors("wycheproof-ecdsa-secp256r1-sha256-p1363.json", as: Wycheproof.self)
  var count = 0
  for group in w.testGroups {
    let key = try P256.Signing.PublicKey(x963Representation: Data(hex: group.publicKey.uncompressed))
    for test in group.tests {
      count += 1
      let ok = verifyP256(key, signature: try Data(hex: test.sig), message: try Data(hex: test.msg))
      #expect(ok == (test.result == "valid"), "tcId \(test.tcId)")
    }
  }
  #expect(count == w.numberOfTests && count == 262)
}

@Test func base64urlIsStrict() throws {
  #expect(Base64URL.encode(Data([0xfb, 0xff])) == "-_8")
  #expect(try Base64URL.decode("-_8") == Data([0xfb, 0xff]))
  for bad in ["-_8=", "+/8", "A", "-_9", "a b"] {
    #expect(throws: KeysError.badBase64URL) { try Base64URL.decode(bad) }
  }
  #expect(throws: KeysError.badPublicKey) { try PublicKeys.signing(Base64URL.encode(Data([4] + Array(repeating: 1, count: 64)))) }
}

@Test func contextRefusesBadLabels() {
  for label in ["", "Request", "a_b", String(repeating: "a", count: 33)] {
    #expect(throws: KeysError.badLabel) { try context(label, []) }
  }
  #expect(throws: KeysError.badId) { try checkId(String(repeating: "a", count: 65)) }
}
```

If a vector test fails, do not change the expected value: the vectors are the contract with the server (`docs/security.md` section 18). Stop and say which case failed in the pull request.

Checks without Xcode: `npm run test:swift -w @waypoint/mobile` (the 16 Keys tests plus the existing Audio and Pages tests), and `swift build --build-tests` in `apps/mobile/modules` prints no warnings. Root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile` still pass (nothing in them changes).

Device check: none (M26b).

Not in this PR: the Expo module, Keychain, Secure Enclave key creation (M26b), BIP-39 (M27b), group-key rotation and sync (M28), any change to `packages/crypto`.

---

### M26b · Native module `waypoint-keys`: Secure Enclave keys, Keychain, request signing

Branch `pr/m26b-keys-module`. After M26a. No npm dependencies. Files, all under `apps/mobile/modules/waypoint-keys/`: `expo-module.config.json`, `index.ts`, `src/WaypointKeys.ts`, `ios/WaypointKeys.podspec`, `ios/WaypointKeysModule.swift`, `ios/IdentityStore.swift`.

Why it looks like this:
- `docs/security.md` sections 5 and 19 item 1: a device **signing** key (`SecureEnclave.P256.Signing.PrivateKey`) and **encryption** key (`SecureEnclave.P256.KeyAgreement.PrivateKey`), created with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and `.privateKeyUsage`; their `dataRepresentation` (an opaque blob only this phone's Secure Enclave can use) is kept in the Keychain with the same accessibility. The account key (64 bytes: signing scalar, then encryption scalar) is a software key kept in the same Keychain item.
- **One Keychain item per Waypoint user** (service `app.waypoint.keys`, account = the server user id from S1G), holding a small JSON record. Two people signing in on one family iPad get separate device rows and separate keys (`docs/security.md` R14).
- Software keys only in the Simulator (`#if targetEnvironment(simulator)`). On a real phone, if the Secure Enclave is not available, key creation fails with `no_secure_enclave`; every iPhone that runs iOS 26 has one.
- Keys never cross into JavaScript. JavaScript gets public keys, signatures and commitments as base64url text, and the opened text of a sealed result.
- `signRequest` takes the body as a string: every signed request has a JSON body that `packages/api-client` sends as `JSON.stringify(...)`, and Swift hashes its UTF-8 bytes, which are the bytes `fetch` sends. It signs only as this device's id or as `"new"` (registration).
- Keychain items have so far survived deleting the app (Apple does not promise it), so a reinstall usually finds the same keys and the same device row, and M27a sees "approved". When they do not survive, M27a registers the iPhone again as a new device.
- Synchronous `getDeviceKeys` (a Keychain read) so M27a can sign at launch before the network answers; the rest are `AsyncFunction`s, which Expo runs off the main thread.

**Checked on this Mac (19 Nov 2026):** `IdentityStore.swift` below, compiled with `Core/` by `swiftc`, ran end to end against this Mac's real Secure Enclave and Keychain: made Secure Enclave keys, read them back, made the account key and a certificate that verifies, made a pairing commitment, signed a request that verifies with `RequestSigning.input`, opened a result sealed to the Secure Enclave encryption key with CryptoKit HPKE, and deleted the item. The Expo module file needs the iOS SDK and is checked on the device.

`expo-module.config.json`, exactly:

```json
{ "platforms": ["apple"], "apple": { "modules": ["WaypointKeysModule"] } }
```

`index.ts`, exactly:

```ts
export * from "./src/WaypointKeys.ts";
```

`src/WaypointKeys.ts`, exactly:

```ts
import { requireNativeModule } from "expo";

// This device's keys for one Waypoint user (docs/security.md sections 5 and 19). Keys never leave the native side;
// public keys and signatures are base64url text. Errors carry error.code: "no_secure_enclave", "no_identity",
// "keychain", or a format error such as "badInput".
export type DeviceKeys = { deviceId: string; signPub: string; boxPub: string; hardware: boolean };
export type AccountKey = { accountId: string; signPub: string; boxPub: string; cert: string };
export type SignedRequest = { nonce: string; signature: string };

type NativeKeys = {
  getDeviceKeys(userId: string): DeviceKeys | null;
  ensureDeviceKeys(userId: string, deviceId: string): Promise<DeviceKeys>;
  deleteDeviceKeys(userId: string): Promise<void>;
  ensureAccountKey(userId: string, accountId: string): Promise<AccountKey>;
  deleteAccountKey(userId: string): Promise<void>;
  startPairing(userId: string): Promise<string>;
  signRequest(userId: string, method: string, target: string, deviceId: string, timestamp: number, body: string): Promise<SignedRequest>;
  openSealedResult(userId: string, jobId: string, sealed: string): Promise<string>;
};

const native = requireNativeModule<NativeKeys>("WaypointKeys");

export const getDeviceKeys = (userId: string): DeviceKeys | null => native.getDeviceKeys(userId);
export const ensureDeviceKeys = (userId: string, deviceId: string): Promise<DeviceKeys> => native.ensureDeviceKeys(userId, deviceId);
export const deleteDeviceKeys = (userId: string): Promise<void> => native.deleteDeviceKeys(userId);
export const ensureAccountKey = (userId: string, accountId: string): Promise<AccountKey> => native.ensureAccountKey(userId, accountId);
export const deleteAccountKey = (userId: string): Promise<void> => native.deleteAccountKey(userId);
export const startPairing = (userId: string): Promise<string> => native.startPairing(userId);
export const signRequest = (userId: string, method: string, target: string, deviceId: string, timestamp: number, body: string): Promise<SignedRequest> =>
  native.signRequest(userId, method, target, deviceId, timestamp, body);
export const openSealedResult = (userId: string, jobId: string, sealed: string): Promise<string> => native.openSealedResult(userId, jobId, sealed);
```

`ios/WaypointKeys.podspec`, exactly (the pod compiles `Core/` with the rest and leaves out `Tests/`):

```ruby
Pod::Spec.new do |s|
  s.name           = 'WaypointKeys'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint device keys and crypto'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
  s.exclude_files  = 'Tests/**/*'
end
```

`ios/IdentityStore.swift`, exactly:

```swift
import CryptoKit
import Foundation
import Security

// This device's keys for one Waypoint user, kept as one Keychain item (docs/security.md sections 5 and 19).
// The Secure Enclave keys are stored as their dataRepresentation, which only this phone's Secure Enclave can use.
struct StoredIdentity: Codable {
  var deviceId: String
  var hardware: Bool // true: Secure Enclave keys; false: software keys (Simulator only)
  var sign: Data
  var box: Data
  var accountId: String?
  var accountKey: Data? // 64 bytes: account signing scalar, then account encryption scalar
  var pairingNonce: String? // base64url, 32 bytes; kept until the pairing ends (M27b)
}

enum IdentityStore {
  static let service = "app.waypoint.keys"

  static func load(userId: String) throws -> StoredIdentity? {
    var query = baseQuery(userId)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else { throw keychainError(status) }
    return try JSONDecoder().decode(StoredIdentity.self, from: data)
  }

  static func save(_ identity: StoredIdentity, userId: String) throws {
    let data = try JSONEncoder().encode(identity)
    let update = SecItemUpdate(baseQuery(userId) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else { throw keychainError(update) }
    var add = baseQuery(userId)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { throw keychainError(status) }
  }

  static func delete(userId: String) throws {
    let status = SecItemDelete(baseQuery(userId) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw keychainError(status) }
  }

  // Makes the two device keys. Secure Enclave on a phone; software keys only in the Simulator.
  static func makeIdentity(deviceId: String) throws -> StoredIdentity {
    if SecureEnclave.isAvailable {
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &error) else {
        throw KeysModuleError.noSecureEnclave
      }
      let sign = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
      let box = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
      return StoredIdentity(deviceId: deviceId, hardware: true, sign: sign.dataRepresentation, box: box.dataRepresentation)
    }
    #if targetEnvironment(simulator)
    return StoredIdentity(deviceId: deviceId, hardware: false, sign: P256.Signing.PrivateKey().rawRepresentation, box: P256.KeyAgreement.PrivateKey().rawRepresentation)
    #else
    throw KeysModuleError.noSecureEnclave
    #endif
  }

  static func signingKey(_ identity: StoredIdentity) throws -> any SigningKey {
    identity.hardware
      ? try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: identity.sign)
      : try P256.Signing.PrivateKey(rawRepresentation: identity.sign)
  }

  static func signPub(_ identity: StoredIdentity) throws -> String { try signingKey(identity).publicKeyText }

  static func boxPub(_ identity: StoredIdentity) throws -> String {
    identity.hardware
      ? boxKeyText(try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: identity.box).publicKey)
      : boxKeyText(try P256.KeyAgreement.PrivateKey(rawRepresentation: identity.box).publicKey)
  }

  static func openSealed(_ identity: StoredIdentity, sealed: Data, jobId: String) throws -> Data {
    identity.hardware
      ? try SealedResult.open(sealed, jobId: jobId, deviceId: identity.deviceId, recipient: try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: identity.box))
      : try SealedResult.open(sealed, jobId: jobId, deviceId: identity.deviceId, recipient: try P256.KeyAgreement.PrivateKey(rawRepresentation: identity.box))
  }

  private static func baseQuery(_ userId: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId]
  }

  private static func keychainError(_ status: OSStatus) -> KeysModuleError { .keychain(Int(status)) }
}

enum KeysModuleError: Error {
  case noSecureEnclave, noIdentity, exists, keychain(Int)

  var code: String {
    switch self {
    case .noSecureEnclave: return "no_secure_enclave"
    case .noIdentity: return "no_identity"
    case .exists: return "exists"
    case .keychain: return "keychain"
    }
  }
}

// What the module's functions do, without ExpoModulesCore. Public keys and signatures are base64url text.
enum KeysOps {
  static func keysView(_ identity: StoredIdentity) throws -> [String: Any] {
    ["deviceId": identity.deviceId, "signPub": try IdentityStore.signPub(identity), "boxPub": try IdentityStore.boxPub(identity), "hardware": identity.hardware]
  }

  static func getDeviceKeys(userId: String) throws -> [String: Any]? {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { return nil }
    return try keysView(identity)
  }

  // Returns the keys already made for this user, or makes them with deviceId.
  static func ensureDeviceKeys(userId: String, deviceId: String) throws -> [String: Any] {
    if let identity = try IdentityStore.load(userId: try checkId(userId)) { return try keysView(identity) }
    let identity = try IdentityStore.makeIdentity(deviceId: try checkId(deviceId))
    try IdentityStore.save(identity, userId: userId)
    return try keysView(identity)
  }

  // Forgets this user's keys (the device was removed, or must register again under a new id).
  static func deleteDeviceKeys(userId: String) throws { try IdentityStore.delete(userId: try checkId(userId)) }

  // First device only: makes the account key (software P-256, docs/security.md section 5), keeps it with the
  // device keys, and certifies this device. Returns the existing account key when there is one.
  static func ensureAccountKey(userId: String, accountId: String) throws -> [String: Any] {
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    if identity.accountId == nil || identity.accountKey == nil {
      let sign = P256.Signing.PrivateKey()
      let box = P256.KeyAgreement.PrivateKey()
      identity.accountId = try checkId(accountId)
      identity.accountKey = sign.rawRepresentation + box.rawRepresentation
      try IdentityStore.save(identity, userId: userId)
    }
    guard let id = identity.accountId, let key = identity.accountKey, key.count == 64 else { throw KeysModuleError.noIdentity }
    let sign = try P256.Signing.PrivateKey(rawRepresentation: key.prefix(32))
    let box = try P256.KeyAgreement.PrivateKey(rawRepresentation: key.suffix(32))
    let cert = try DeviceCertificate.sign(sign, userId: userId, deviceId: identity.deviceId, signPub: try IdentityStore.signPub(identity), boxPub: try IdentityStore.boxPub(identity))
    return ["accountId": id, "signPub": sign.publicKeyText, "boxPub": boxKeyText(box.publicKey), "cert": cert]
  }

  // Another device already holds the account key: drop ours (a lost race to be the first device).
  static func deleteAccountKey(userId: String) throws {
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { return }
    identity.accountId = nil
    identity.accountKey = nil
    try IdentityStore.save(identity, userId: userId)
  }

  // A new device's pairing commitment (docs/security.md section 8). The nonce stays in the Keychain, unrevealed.
  static func startPairing(userId: String) throws -> String {
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    let nonce = identity.pairingNonce ?? Pairing.newNonce()
    identity.pairingNonce = nonce
    try IdentityStore.save(identity, userId: userId)
    return try Pairing.commitment(signPub: try IdentityStore.signPub(identity), boxPub: try IdentityStore.boxPub(identity), newNonce: nonce)
  }

  static func signRequest(userId: String, method: String, target: String, deviceId: String, timestamp: Double, body: String) throws -> [String: Any] {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    guard deviceId == identity.deviceId || deviceId == RequestSigning.newDevice else { throw KeysError.badInput }
    let signed = try RequestSigning.sign(try IdentityStore.signingKey(identity), method: method, target: target, deviceId: deviceId, timestamp: Int64(timestamp), body: Data(body.utf8))
    return ["nonce": signed.nonce, "signature": signed.signature]
  }

  // A job result sealed to this device (docs/security.md section 14); returns its UTF-8 text.
  static func openSealedResult(userId: String, jobId: String, sealed: String) throws -> String {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    let plain = try IdentityStore.openSealed(identity, sealed: try Base64URL.decode(sealed), jobId: jobId)
    guard let text = String(data: plain, encoding: .utf8) else { throw KeysError.badSealed }
    return text
  }
}
```

`ios/WaypointKeysModule.swift`, exactly:

```swift
import ExpoModulesCore

// This device's keys (docs/security.md section 19). Thin: the work is in IdentityStore.swift and Core/.
public class WaypointKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WaypointKeys")

    Function("getDeviceKeys") { (userId: String) throws -> [String: Any]? in
      try coded { try KeysOps.getDeviceKeys(userId: userId) }
    }
    AsyncFunction("ensureDeviceKeys") { (userId: String, deviceId: String) throws -> [String: Any] in
      try coded { try KeysOps.ensureDeviceKeys(userId: userId, deviceId: deviceId) }
    }
    AsyncFunction("deleteDeviceKeys") { (userId: String) throws in
      try coded { try KeysOps.deleteDeviceKeys(userId: userId) }
    }
    AsyncFunction("ensureAccountKey") { (userId: String, accountId: String) throws -> [String: Any] in
      try coded { try KeysOps.ensureAccountKey(userId: userId, accountId: accountId) }
    }
    AsyncFunction("deleteAccountKey") { (userId: String) throws in
      try coded { try KeysOps.deleteAccountKey(userId: userId) }
    }
    AsyncFunction("startPairing") { (userId: String) throws -> String in
      try coded { try KeysOps.startPairing(userId: userId) }
    }
    AsyncFunction("signRequest") { (userId: String, method: String, target: String, deviceId: String, timestamp: Double, body: String) throws -> [String: Any] in
      try coded { try KeysOps.signRequest(userId: userId, method: method, target: target, deviceId: deviceId, timestamp: timestamp, body: body) }
    }
    AsyncFunction("openSealedResult") { (userId: String, jobId: String, sealed: String) throws -> String in
      try coded { try KeysOps.openSealedResult(userId: userId, jobId: jobId, sealed: sealed) }
    }
  }
}

// Our errors become an Exception whose code JavaScript reads as error.code.
private func coded<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as KeysModuleError {
    throw Exception(name: "WaypointKeys", description: error.code, code: error.code)
  } catch let error as KeysError {
    throw Exception(name: "WaypointKeys", description: "\(error)", code: "\(error)")
  } catch {
    throw Exception(name: "WaypointKeys", description: "key operation failed", code: "failed")
  }
}
```

Checks without Xcode:
- `cd apps/mobile/modules/waypoint-keys/ios && swiftc -typecheck Core/*.swift IdentityStore.swift` prints nothing.
- `npm run test:swift -w @waypoint/mobile` still passes.
- `npx expo-modules-autolinking resolve --platform apple` (in `apps/mobile`) lists `WaypointKeysModule`.
- Root `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.
- Say in the pull request that `WaypointKeysModule.swift` was not compiled (no Xcode yet).

Device check (needs Xcode; a scratch route such as `src/app/dev/keys.tsx`, as the stage 1 modules did, deleted before merging):
1. On the iPhone: `ensureDeviceKeys("u_test", "dev_test_1")` returns `hardware: true`; calling it again with another id returns the same keys; relaunch the app and `getDeviceKeys("u_test")` returns them.
2. `signRequest("u_test", "POST", "/v1/x", "dev_test_1", Date.now(), "{}")` returns a 22-character nonce and an 86-character signature; a second call returns another nonce. `signRequest` with device id `"dev_other"` fails with code `badInput`.
3. In the Simulator, `hardware` is `false`.
4. `deleteDeviceKeys("u_test")`, then `getDeviceKeys("u_test")` is `null`.

Not in this PR: registering with the server (M27a), pairing beyond the commitment, envelopes and group keys (M27b, M28), the recovery key (M27b), Face ID on key use.

---

### M27a · Register this iPhone after sign-in, and the "waiting for approval" path

Branch `pr/m27a-register-device`. After M13, M26b and S1G. Dependencies: `expo-device` 58.0.5 (published 2026-10-01; SDK 58's `bundledNativeModules.json` asks for `~58.0.5`). Files, all under `apps/mobile/`: `package.json`, `src/core/device/registration.ts`, `src/platform/device.ts`, `src/shell/DeviceWaitingScreen.tsx`, `src/app/device-waiting.tsx`, `src/app/_layout.tsx` (one screen line), `src/app/(tabs)/_layout.tsx` (one hook call), `test/registration.test.ts`. Plus `package-lock.json`.

Why it looks like this:
- From S1E on, every paid task and `POST /v1/purchases/apple` must be signed by an approved device (`docs/build-plan.md` decision 5). So right after sign-in the app registers this iPhone. Nobody sees it happen.
- **First device** (`docs/security.md` section 8, "The first device"): the account has no account key yet. This iPhone makes its two Secure Enclave keys, makes the account key, signs its own certificate with it, and calls `POST /v1/devices` with `account: { id, sign_pub, box_pub, cert }`, signed as device `"new"` with its new signing key. S1B approves it at once.
- **Another device already exists**: this iPhone registers as **waiting** with a pairing commitment (`commitment`, from a nonce kept unrevealed in the Keychain) and shows "This iPhone needs approval" whenever a paid action is tried. The approving side, the 6-digit code and the reveal are M27b (stage 4), so until then a second device stays waiting. The copy says so. Free features are not affected.
- The plan is decided by a pure function from `GET /v1/devices` (which carries `user_id` after S1G) and the keys in the Keychain, so every case is tested in Node. Every step can be repeated: keys are made once (`ensureDeviceKeys`), the account key is made once (`ensureAccountKey`), and a lost reply is fixed by asking `GET /v1/devices` again on the next launch.
- If two devices race to be first, the second gets 409 "account key already set": it drops its account key and registers as waiting.
- Offline launch: the server user id and the last status are kept in the `settings` table, so an iPhone that was approved signs straight away.
- `requireApprovedDevice()` is the one gate every paid action calls first (stage 2 rule 4). It also opens "Update Waypoint" when M13 says the build is too old.
- The recovery key prompt is M27b. Until stage 4 nothing on the server is locked with the account key, so nothing is lost without it (but see the open question on a lost first phone).

`apps/mobile/package.json`: add `"expo-device": "58.0.5"` to `dependencies`.

`src/core/device/registration.ts`, exactly:

```ts
import type { DeviceView } from "@waypoint/contracts";

// This iPhone's keys for the signed-in person, as the keys module reports them (M26b).
export type LocalKeys = { deviceId: string; signPub: string; boxPub: string };

// What to do after sign-in, from the server's device list and the keys on this iPhone (docs/security.md section 8).
export type Plan =
  | { kind: "approved"; deviceId: string } // registered and approved: it can sign paid requests
  | { kind: "waiting"; deviceId: string } // registered, waiting for another device to approve it
  | { kind: "register_first" } // the account has no account key yet: this iPhone becomes the first device
  | { kind: "register_waiting" } // the account already has a device: register this one as waiting
  | { kind: "start_over" }; // the server does not know our keys (removed, or never sent): forget them, then register as waiting

export function planRegistration(devices: DeviceView[], local: LocalKeys | null): Plan {
  const hasAccount = devices.some((d) => d.kind === "account");
  if (local !== null) {
    const mine = devices.find((d) => d.kind === "device" && d.id === local.deviceId);
    if (mine !== undefined) {
      if (mine.sign_pub !== local.signPub || mine.box_pub !== local.boxPub) return { kind: "start_over" };
      return mine.approved_at === null ? { kind: "waiting", deviceId: mine.id } : { kind: "approved", deviceId: mine.id };
    }
  }
  if (!hasAccount) return { kind: "register_first" };
  return local === null ? { kind: "register_waiting" } : { kind: "start_over" };
}

// The name the server stores: the model, never the person's name (docs/security.md section 16).
export function deviceName(modelName: string | null): string {
  const name = (modelName ?? "").trim();
  return name === "" ? "iPhone" : name.slice(0, 64);
}

export type DeviceStatus = "checking" | "approved" | "waiting" | "too_many_waiting" | "offline" | "signed_out";

// Settings keys. The server user id is kept per Clerk user so the app can sign offline.
export const userIdKey = (clerkUserId: string): string => `server_user_id:${clerkUserId}`;
export const statusKey = (userId: string): string => `device_status:${userId}`;
```

`src/platform/device.ts`, exactly (type-checked here against `@clerk/expo` 4.15.1, `expo-device` 58.0.5 and the M26b module):

```ts
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { randomUUID } from "expo-crypto";
import * as Device from "expo-device";
import { router } from "expo-router";
import { ApiCallError, NetworkError, type DeviceSigner } from "@waypoint/api-client";
import { deviceName, planRegistration, statusKey, userIdKey, type DeviceStatus } from "../core/device/registration.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import {
  deleteAccountKey,
  deleteDeviceKeys,
  ensureAccountKey,
  ensureDeviceKeys,
  getDeviceKeys,
  signRequest,
  startPairing,
} from "../../modules/waypoint-keys/index.ts";
import { api, setDeviceSigner } from "./api.ts";
import { isUpdateRequired } from "./config.ts";
import { getDb, writeDb } from "./db.ts";

let status: DeviceStatus = "checking";
let userId: string | null = null;
let clerkId: string | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: DeviceStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function signerFor(user: string, deviceId: string): DeviceSigner {
  return {
    id: deviceId,
    sign: (input) => signRequest(user, input.method, input.target, input.deviceId, input.timestamp, input.body),
  };
}

function approve(user: string, deviceId: string): void {
  setDeviceSigner(signerFor(user, deviceId));
  writeDb((db) => setSetting(db, statusKey(user), "approved"));
  setStatus("approved");
}

function wait(user: string): void {
  setDeviceSigner(null);
  writeDb((db) => setSetting(db, statusKey(user), "waiting"));
  setStatus("waiting");
}

// One pass of M27a's flow. Safe to run again at any time; every step can be repeated.
async function register(clerkUserId: string, firstTry = true): Promise<void> {
  const list = await api.devices();
  userId = list.user_id;
  const user = list.user_id;
  writeDb((db) => setSetting(db, userIdKey(clerkUserId), user));
  const plan = planRegistration(list.devices, getDeviceKeys(user));
  if (plan.kind === "approved") return approve(user, plan.deviceId);
  if (plan.kind === "waiting") return wait(user);
  if (plan.kind === "start_over") await deleteDeviceKeys(user);
  const keys = await ensureDeviceKeys(user, randomUUID());
  const registerSigner = signerFor(user, keys.deviceId);
  const base = { id: keys.deviceId, name: deviceName(Device.modelName), platform: "ios" as const, sign_pub: keys.signPub, box_pub: keys.boxPub };
  if (plan.kind === "register_first") {
    const account = await ensureAccountKey(user, randomUUID());
    try {
      await api.registerDevice(
        { ...base, account: { id: account.accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert: account.cert } },
        registerSigner,
      );
      return approve(user, keys.deviceId);
    } catch (error) {
      // Another device became the first one meanwhile: drop our account key and register as waiting.
      if (!(firstTry && error instanceof ApiCallError && error.status === 409)) throw error;
      await deleteAccountKey(user);
      return register(clerkUserId, false);
    }
  }
  const commitment = await startPairing(user);
  await api.registerDevice({ ...base, commitment }, registerSigner);
  wait(user);
}

// Runs the flow unless it is already running. Network trouble leaves the last known status in place.
function refreshDevice(clerkUserId: string): Promise<void> {
  if (running !== null) return running;
  running = register(clerkUserId)
    .catch((error: unknown) => {
      if (error instanceof ApiCallError && error.status === 429) setStatus("too_many_waiting");
      else if (error instanceof NetworkError && status === "checking") setStatus("offline");
    })
    .finally(() => {
      running = null;
    });
  return running;
}

// Checks again now, for the signed-in person (the waiting screen's "Check again", the "approved" push in M20).
export function refreshDeviceNow(): Promise<void> {
  return clerkId === null ? Promise.resolve() : refreshDevice(clerkId);
}

// Before the network answers: if this iPhone was approved last time, sign with its keys straight away.
function restore(clerkUserId: string): void {
  const db = getDb();
  const user = getSetting(db, userIdKey(clerkUserId));
  if (user === null) return;
  userId = user;
  const keys = getDeviceKeys(user);
  if (keys !== null && getSetting(db, statusKey(user)) === "approved") {
    setDeviceSigner(signerFor(user, keys.deviceId));
    setStatus("approved");
  }
}

// Called once in (tabs)/_layout.tsx.
export function useDeviceRegistration(): void {
  const { isSignedIn, userId: clerkUserId } = useAuth();
  useEffect(() => {
    if (isSignedIn !== true || clerkUserId === null || clerkUserId === undefined) {
      setDeviceSigner(null);
      userId = null;
      clerkId = null;
      setStatus("signed_out");
      return;
    }
    clerkId = clerkUserId;
    setStatus("checking");
    restore(clerkUserId);
    void refreshDevice(clerkUserId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && status !== "approved") void refreshDevice(clerkUserId);
    });
    return () => sub.remove();
  }, [isSignedIn, clerkUserId]);
}

export function useDeviceStatus(): DeviceStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => status,
  );
}

// The server's id for the signed-in person (StoreKit's appAccountToken, M14), once known.
export function currentUserId(): string | null {
  return userId;
}

// Every paid action calls this first. false: it opened the screen that explains why, and the action must stop.
export function requireApprovedDevice(): boolean {
  if (isUpdateRequired()) {
    router.push("/update");
    return false;
  }
  if (status === "approved") return true;
  router.push("/device-waiting");
  return false;
}
```

`src/shell/DeviceWaitingScreen.tsx`, exactly (copy written for this card; check it against the boards):

```tsx
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { DeviceStatus } from "../core/device/registration.ts";
import { refreshDeviceNow, useDeviceStatus } from "../platform/device.ts";
import { Body, Caption, OnDeviceNote, PrimaryButton, Screen, SecondaryButton, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

// Shown when a paid action needs an approved device and this iPhone is not one (yet).
export default function DeviceWaitingScreen() {
  const colors = useColors();
  const status = useDeviceStatus();
  const [checking, setChecking] = useState(false);

  async function checkAgain(): Promise<void> {
    setChecking(true);
    await refreshDeviceNow();
    setChecking(false);
  }

  const copy = COPY[status];
  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name={status === "approved" ? "checkmark.shield.fill" : "lock.shield"} tintColor={colors.accent} size={40} />
      </View>
      <Title>{copy.title}</Title>
      <Body>{copy.body}</Body>
      {copy.caption !== "" ? <Caption>{copy.caption}</Caption> : null}
      <OnDeviceNote text="Everything on this iPhone keeps working: recording, pages, flashcards and search." />
      <View style={styles.actions}>
        {status === "approved" ? (
          <PrimaryButton label="Done" onPress={() => router.back()} />
        ) : (
          <PrimaryButton label={checking ? "Checking…" : "Check again"} onPress={() => void checkAgain()} />
        )}
        {status === "approved" ? null : <SecondaryButton label="Close" onPress={() => router.back()} />}
      </View>
    </Screen>
  );
}

const COPY: Record<DeviceStatus, { title: string; body: string; caption: string }> = {
  waiting: {
    title: "This iPhone needs approval",
    body: "Your Waypoint account is already set up on another iPhone or iPad. That device needs to approve this one before it can use credits.",
    caption: "Approving from your other device comes in a later update.",
  },
  checking: { title: "Setting up this iPhone", body: "Waypoint is getting this iPhone ready to use credits.", caption: "" },
  offline: { title: "You're offline", body: "Connect to the internet so Waypoint can set up this iPhone for credits.", caption: "" },
  too_many_waiting: { title: "Too many devices waiting", body: "Three devices are already waiting for approval. Try again in 10 minutes.", caption: "" },
  signed_out: { title: "Sign in to use credits", body: "Credits belong to your Waypoint account.", caption: "" },
  approved: { title: "This iPhone is ready", body: "It can use credits now.", caption: "" },
};

const styles = StyleSheet.create({
  badge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  actions: { gap: 12, marginTop: 24 },
});
```

`src/app/device-waiting.tsx` only re-exports the screen. `src/app/_layout.tsx`: inside the signed-in `Stack.Protected`, add `<Stack.Screen name="device-waiting" options={{ presentation: "modal" }} />`. `src/app/(tabs)/_layout.tsx`: call `useDeviceRegistration()` next to the other hooks.

`test/registration.test.ts`, exactly:

```ts
import type { DeviceView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { deviceName, planRegistration, statusKey, userIdKey } from "../src/core/device/registration.ts";

const KEY_A = "A".repeat(87);
const KEY_B = "B".repeat(87);

function row(over: Partial<DeviceView>): DeviceView {
  return { id: "dev_1", kind: "device", name: "iPhone", platform: "ios", sign_pub: KEY_A, box_pub: KEY_B, cert: null, account_envelope: null, added_at: 1, approved_at: 1, approved_by: null, ...over };
}
const ACCOUNT = row({ id: "acct_1", kind: "account", name: "Account key", platform: "account" });
const LOCAL = { deviceId: "dev_1", signPub: KEY_A, boxPub: KEY_B };

describe("planRegistration", () => {
  it("an empty account makes this iPhone the first device, with or without local keys", () => {
    expect(planRegistration([], null)).toEqual({ kind: "register_first" });
    expect(planRegistration([], LOCAL)).toEqual({ kind: "register_first" });
  });
  it("our approved row is approved; our row without approved_at is waiting", () => {
    expect(planRegistration([ACCOUNT, row({})], LOCAL)).toEqual({ kind: "approved", deviceId: "dev_1" });
    expect(planRegistration([ACCOUNT, row({ approved_at: null })], LOCAL)).toEqual({ kind: "waiting", deviceId: "dev_1" });
  });
  it("an account with another device: register as waiting, or start over when our keys are unknown", () => {
    const other = row({ id: "dev_other" });
    expect(planRegistration([ACCOUNT, other], null)).toEqual({ kind: "register_waiting" });
    expect(planRegistration([ACCOUNT, other], LOCAL)).toEqual({ kind: "start_over" });
  });
  it("a row with our id but other keys means start over", () => {
    expect(planRegistration([ACCOUNT, row({ sign_pub: KEY_B })], LOCAL)).toEqual({ kind: "start_over" });
  });
  it("the account row itself never counts as our device", () => {
    expect(planRegistration([row({ id: "dev_1", kind: "account" })], LOCAL)).toEqual({ kind: "start_over" });
  });
});

describe("names and keys", () => {
  it("deviceName", () => {
    expect(deviceName("iPhone 16 Pro")).toBe("iPhone 16 Pro");
    expect(deviceName(null)).toBe("iPhone");
    expect(deviceName("  ")).toBe("iPhone");
    expect(deviceName("x".repeat(80))).toHaveLength(64);
  });
  it("settings keys", () => {
    expect(userIdKey("user_2abc")).toBe("server_user_id:user_2abc");
    expect(statusKey("u1")).toBe("device_status:u1");
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (needs Xcode, the API with S1B and S1G, and `EXPO_PUBLIC_API_URL`):
1. Sign in with a new account. Within a few seconds `GET /v1/devices` (run with that user's token, or read D1) lists two rows: the account row ("Account key") and this iPhone (`approved_at` set, `cert` set, name the phone's model).
2. Relaunch with Airplane Mode on: no error; `useDeviceStatus()` is `"approved"` straight away.
3. Sign out and sign in as a second new account on the same phone: a second, separate pair of rows for that account.
4. On a second phone (or the Simulator), sign in with the first account: it registers as waiting (`approved_at` null, a `device_pairings` row). Calling `requireApprovedDevice()` from a scratch button opens "This iPhone needs approval"; "Check again" keeps it there.
5. Delete the app on the first phone and reinstall it: after sign-in it is normally still "approved" (the Keychain kept its keys). If iOS removed them, it registers as a new waiting device (question 2 in section 5); note which happened.

Not in this PR: approving another device, the 6-digit code, reveal (M27b), removing a device (M27b), the recovery key (M27b), a Settings row for devices (M27b), push for "approved" (M20).

---

### M14 · Native module `waypoint-store`: StoreKit 2 purchases to `POST /v1/purchases/apple`

Branch `pr/m14-storekit`. After M27a (and the server's PR 17 and S1E, merged). No npm dependencies. Files, all under `apps/mobile/`: `modules/waypoint-store/expo-module.config.json`, `index.ts`, `src/WaypointStore.ts`, `ios/WaypointStore.podspec`, `ios/WaypointStoreModule.swift`, `ios/StoreBridge.swift`; `src/core/store/products.ts`, `src/platform/store.ts`, `src/app/(tabs)/_layout.tsx` (one hook call), `test/products.test.ts`.

Why it looks like this (`docs/architecture.md` flow 5):
- StoreKit 2 on the phone. A purchase uses `Product.purchase(confirmIn:options:)` with `.appAccountToken(<server user id as UUID>)`; the server compares the token with `users.id` (PR 17), and Apple's notices for the same transaction find the same account (PR 18). The user id comes from M27a (`currentUserId()`), which got it from S1G.
- `purchase(confirmIn:)` takes the window scene the sheet appears in. Apple's guidance for UIKit apps is to use it rather than `purchase(options:)`; developers report "Could not find a visible window in the scene" failures with the latter from iOS 18.2 on ([Apple Developer Forums 770751](https://developer.apple.com/forums/thread/770751)).
- The app sends the transaction's `jwsRepresentation` to `POST /v1/purchases/apple` (signed by this device: M27a must have it approved) and **finishes the transaction only after the server decided** (granted, or 409 "belongs to another account" / "was refunded"). Anything else stays unfinished and is sent again: at the next launch (`Transaction.unfinished`), and whenever StoreKit reports one (`Transaction.updates`, which also brings Ask to Buy approvals, renewals and purchases from another device). So money paid to Apple always reaches the wallet.
- One Idempotency-Key per transaction (`apple_txn_<id>`), so sending a transaction twice replays the server's first reply (PR 11 store) and the wallet grants once per transaction id anyway.
- `requireApprovedDevice()` runs **before** StoreKit opens, so nobody pays Apple from an iPhone that cannot tell the server yet.
- Ask to Buy: a child's purchase can come back `pending`; the parent's approval later arrives through `Transaction.updates`.
- Family Sharing: a transaction with `ownershipType == .familyShared` is passed on with `familyShared: true`; the server gives access only, no credits (PR 17).
- Only verified transactions (StoreKit's `.verified`) are passed to JavaScript; the server checks Apple's signature again.
- Testable logic is in TypeScript (`src/core/store/products.ts`). `StoreBridge.swift` was compiled here against the macOS StoreKit; the module file needs the iOS SDK (`UIWindowScene`) and is checked on the device.

`modules/waypoint-store/expo-module.config.json`, exactly:

```json
{ "platforms": ["apple"], "apple": { "modules": ["WaypointStoreModule"] } }
```

`index.ts`, exactly:

```ts
export * from "./src/WaypointStore.ts";
```

`src/WaypointStore.ts`, exactly:

```ts
import { NativeModule, requireNativeModule, type EventSubscription } from "expo";

export type StoreProduct = {
  id: string;
  displayName: string;
  displayPrice: string; // in the person's own currency, from the App Store
  kind: "consumable" | "non_consumable" | "subscription" | "other";
  familyShareable: boolean;
};
// jws is the transaction's jwsRepresentation: what POST /v1/purchases/apple takes as signed_transaction.
export type StoreTransaction = { jws: string; transactionId: string; productId: string; familyShared: boolean };
export type PurchaseResult =
  | { status: "purchased"; transaction: StoreTransaction }
  | { status: "pending" } // Ask to Buy, or a payment that needs action
  | { status: "cancelled" }
  | { status: "unverified" }; // Apple's signature did not check out on the phone; nothing is sent

type Events = { onTransaction(transaction: StoreTransaction): void };

declare class WaypointStoreNative extends NativeModule<Events> {
  products(ids: string[]): Promise<StoreProduct[]>;
  purchase(productId: string, appAccountToken: string): Promise<PurchaseResult>;
  unfinishedTransactions(): Promise<StoreTransaction[]>;
  finish(transactionId: string): Promise<boolean>;
  restore(): Promise<StoreTransaction[]>;
}

const native = requireNativeModule<WaypointStoreNative>("WaypointStore");

// Errors carry error.code: "bad_token", "unknown_product", "no_window", "purchase_failed".
export const products = (ids: string[]): Promise<StoreProduct[]> => native.products(ids);
export const purchase = (productId: string, appAccountToken: string): Promise<PurchaseResult> => native.purchase(productId, appAccountToken);
export const unfinishedTransactions = (): Promise<StoreTransaction[]> => native.unfinishedTransactions();
export const finish = (transactionId: string): Promise<boolean> => native.finish(transactionId);
export const restore = (): Promise<StoreTransaction[]> => native.restore();
export const addTransactionListener = (listener: (transaction: StoreTransaction) => void): EventSubscription =>
  native.addListener("onTransaction", listener);
```

`ios/WaypointStore.podspec`, exactly (this module has no `Core/` or `Tests/`):

```ruby
Pod::Spec.new do |s|
  s.name           = 'WaypointStore'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint StoreKit 2 purchases'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
```

`ios/StoreBridge.swift`, exactly:

```swift
import Foundation
import StoreKit

// StoreKit 2 calls the module makes, as plain dictionaries for JavaScript. Only verified transactions are passed on;
// the server checks Apple's signature again (POST /v1/purchases/apple).
enum StoreBridge {
  static func kind(_ type: Product.ProductType) -> String {
    switch type {
    case .consumable: return "consumable"
    case .nonConsumable: return "non_consumable"
    case .autoRenewable: return "subscription"
    default: return "other"
    }
  }

  static func products(_ ids: [String]) async throws -> [[String: Any]] {
    try await Product.products(for: ids).map { p in
      ["id": p.id, "displayName": p.displayName, "displayPrice": p.displayPrice, "kind": kind(p.type), "familyShareable": p.isFamilyShareable]
    }
  }

  static func view(_ result: VerificationResult<Transaction>) -> [String: Any]? {
    guard case .verified(let t) = result else { return nil }
    return ["jws": result.jwsRepresentation, "transactionId": String(t.id), "productId": t.productID, "familyShared": t.ownershipType == .familyShared]
  }

  static func purchaseResult(_ result: Product.PurchaseResult) -> [String: Any] {
    switch result {
    case .success(let verification):
      guard let transaction = view(verification) else { return ["status": "unverified"] }
      return ["status": "purchased", "transaction": transaction]
    case .userCancelled: return ["status": "cancelled"]
    case .pending: return ["status": "pending"]
    @unknown default: return ["status": "cancelled"]
    }
  }

  static func collect(_ sequence: Transaction.Transactions) async -> [[String: Any]] {
    var out: [[String: Any]] = []
    for await result in sequence {
      if let t = view(result) { out.append(t) }
    }
    return out
  }

  static func finish(_ transactionId: String) async -> Bool {
    for await result in Transaction.unfinished {
      if case .verified(let t) = result, String(t.id) == transactionId {
        await t.finish()
        return true
      }
    }
    return false
  }

  static func restore() async throws -> [[String: Any]] {
    try await AppStore.sync()
    return await collect(Transaction.currentEntitlements)
  }
}
```

`ios/WaypointStoreModule.swift`, exactly:

```swift
import ExpoModulesCore
import StoreKit

// StoreKit 2 (docs/architecture.md flow 5). The app sends every verified transaction to POST /v1/purchases/apple and
// calls finish only after the server has it, so a purchase is never lost between Apple and our wallet.
public class WaypointStoreModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("WaypointStore")
    Events("onTransaction")

    // Renewals, Ask to Buy approvals and purchases made on another device arrive here. Start listening at once.
    OnCreate {
      self.updates = Task { [weak self] in
        for await result in Transaction.updates {
          if let transaction = StoreBridge.view(result) { self?.sendEvent("onTransaction", transaction) }
        }
      }
    }

    OnDestroy {
      self.updates?.cancel()
    }

    AsyncFunction("products") { (ids: [String]) async throws -> [[String: Any]] in
      try await StoreBridge.products(ids)
    }

    // appAccountToken is the server's user id (a UUID; PR 17 checks it), so Apple's notices name the same account.
    AsyncFunction("purchase") { (productId: String, appAccountToken: String) async throws -> [String: Any] in
      guard let token = UUID(uuidString: appAccountToken) else {
        throw Exception(name: "WaypointStore", description: "bad account token", code: "bad_token")
      }
      guard let product = try await Product.products(for: [productId]).first else {
        throw Exception(name: "WaypointStore", description: "unknown product", code: "unknown_product")
      }
      let scene = await MainActor.run { self.appContext?.utilities?.currentViewController()?.view.window?.windowScene }
      guard let scene else {
        throw Exception(name: "WaypointStore", description: "no window to show the purchase sheet", code: "no_window")
      }
      do {
        let result = try await product.purchase(confirmIn: scene, options: [.appAccountToken(token)])
        return StoreBridge.purchaseResult(result)
      } catch StoreKitError.userCancelled {
        return ["status": "cancelled"]
      } catch {
        throw Exception(name: "WaypointStore", description: error.localizedDescription, code: "purchase_failed")
      }
    }

    AsyncFunction("unfinishedTransactions") { () async -> [[String: Any]] in
      await StoreBridge.collect(Transaction.unfinished)
    }

    AsyncFunction("finish") { (transactionId: String) async -> Bool in
      await StoreBridge.finish(transactionId)
    }

    AsyncFunction("restore") { () async throws -> [[String: Any]] in
      try await StoreBridge.restore()
    }
  }
}
```

`src/core/store/products.ts`, exactly:

```ts
// The App Store products (docs/architecture.md section 7). Ids must match App Store Connect and the server's
// APPLE_PRODUCTS (apps/api/src/apple/products.ts).
export const PRODUCT_IDS = [
  "waypoint.own_it",
  "waypoint.plus.monthly",
  "waypoint.plus.yearly",
  "waypoint.credits.1000",
  "waypoint.credits.5000",
  "waypoint.credits.20000",
] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];
export type ProductInfo = { id: ProductId; kind: "own_it" | "plus" | "pack"; credits: number; period: "monthly" | "yearly" | null };

export const PRODUCTS: Readonly<Record<ProductId, ProductInfo>> = {
  "waypoint.own_it": { id: "waypoint.own_it", kind: "own_it", credits: 2000, period: null },
  "waypoint.plus.monthly": { id: "waypoint.plus.monthly", kind: "plus", credits: 2000, period: "monthly" },
  "waypoint.plus.yearly": { id: "waypoint.plus.yearly", kind: "plus", credits: 2000, period: "yearly" },
  "waypoint.credits.1000": { id: "waypoint.credits.1000", kind: "pack", credits: 1000, period: null },
  "waypoint.credits.5000": { id: "waypoint.credits.5000", kind: "pack", credits: 5000, period: null },
  "waypoint.credits.20000": { id: "waypoint.credits.20000", kind: "pack", credits: 20000, period: null },
};

export function isProductId(id: string): id is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(id);
}

// One Idempotency-Key per App Store transaction, so a transaction sent again (next launch, restore, Transaction.updates)
// replays the server's first reply instead of running twice. Transaction ids are decimal.
export function purchaseKey(transactionId: string): string {
  if (!/^\d{1,50}$/.test(transactionId)) throw new RangeError("bad transaction id");
  return `apple_txn_${transactionId.padStart(6, "0")}`;
}

// What the server's answer to POST /v1/purchases/apple means for the transaction on the phone.
export type SendOutcome = "granted" | "other_account" | "refunded" | "invalid" | "retry_later";

export function sendOutcome(failure: { status: number; message: string } | null): SendOutcome {
  if (failure === null) return "granted";
  if (failure.status === 409 && failure.message === "purchase belongs to another account") return "other_account";
  if (failure.status === 409 && failure.message === "purchase was refunded") return "refunded";
  if (failure.status === 400) return "invalid";
  return "retry_later";
}

// Finish (tell StoreKit we are done) only when the server has decided. "invalid" stays unfinished so it can be looked at
// (for example a sandbox purchase sent to a production server); "retry_later" is sent again on the next launch.
export function shouldFinish(outcome: SendOutcome): boolean {
  return outcome === "granted" || outcome === "other_account" || outcome === "refunded";
}
```

`src/platform/store.ts`, exactly:

```ts
import { useEffect } from "react";
import type { ApplePurchaseResponse } from "@waypoint/contracts";
import { ApiCallError } from "@waypoint/api-client";
import { PRODUCTS, PRODUCT_IDS, isProductId, purchaseKey, sendOutcome, shouldFinish, type ProductId, type ProductInfo, type SendOutcome } from "../core/store/products.ts";
import * as Store from "../../modules/waypoint-store/index.ts";
import { api } from "./api.ts";
import { currentUserId, requireApprovedDevice, useDeviceStatus } from "./device.ts";

export type ShopProduct = Store.StoreProduct & { info: ProductInfo };

// The six products with their App Store prices, in PRODUCT_IDS order. Missing ones (not set up in App Store Connect) are left out.
export async function loadProducts(): Promise<ShopProduct[]> {
  const found = await Store.products([...PRODUCT_IDS]);
  const byId = new Map(found.map((p) => [p.id, p]));
  return PRODUCT_IDS.flatMap((id) => {
    const product = byId.get(id);
    return product === undefined ? [] : [{ ...product, info: PRODUCTS[id] }];
  });
}

export type Sent = { outcome: SendOutcome; reply: ApplePurchaseResponse | null };

// Sends one transaction to the server and finishes it when the server has decided. Never throws.
export async function sendTransaction(transaction: Store.StoreTransaction): Promise<Sent> {
  let reply: ApplePurchaseResponse | null = null;
  let outcome: SendOutcome;
  try {
    reply = await api.applePurchase(transaction.jws, purchaseKey(transaction.transactionId));
    outcome = "granted";
  } catch (error) {
    outcome = error instanceof ApiCallError ? sendOutcome({ status: error.status, message: error.message }) : "retry_later";
  }
  if (shouldFinish(outcome)) await Store.finish(transaction.transactionId).catch(() => false);
  return { outcome, reply };
}

export type BuyResult =
  | { kind: "granted"; reply: ApplePurchaseResponse }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "not_ready" } // requireApprovedDevice() opened a screen; StoreKit was not started
  | { kind: "other_account" }
  | { kind: "saved" } // paid, but the server could not be reached: sent again on the next launch
  | { kind: "failed" };

export async function buy(productId: ProductId): Promise<BuyResult> {
  if (!requireApprovedDevice()) return { kind: "not_ready" };
  const userId = currentUserId();
  if (userId === null) return { kind: "not_ready" };
  let result: Store.PurchaseResult;
  try {
    result = await Store.purchase(productId, userId);
  } catch {
    return { kind: "failed" };
  }
  if (result.status === "pending") return { kind: "pending" };
  if (result.status !== "purchased") return result.status === "cancelled" ? { kind: "cancelled" } : { kind: "failed" };
  const sent = await sendTransaction(result.transaction);
  if (sent.outcome === "granted" && sent.reply !== null) return { kind: "granted", reply: sent.reply };
  if (sent.outcome === "other_account") return { kind: "other_account" };
  if (sent.outcome === "retry_later") return { kind: "saved" };
  return { kind: "failed" };
}

// Restore (O-board "Restore purchases"): Own it and Plus come back from Transaction.currentEntitlements and are sent
// again; the server grants nothing twice. Returns how many the server accepted.
export async function restorePurchases(): Promise<number> {
  if (!requireApprovedDevice()) return 0;
  const transactions = await Store.restore();
  let accepted = 0;
  for (const transaction of transactions) {
    if (!isProductId(transaction.productId)) continue;
    if ((await sendTransaction(transaction)).outcome === "granted") accepted += 1;
  }
  return accepted;
}

// Called once in (tabs)/_layout.tsx. Once this iPhone is approved: sends what StoreKit still has unfinished (a purchase
// whose reply was lost, an Ask to Buy approved later, a renewal) and listens for new transactions.
export function useStoreSync(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    void Store.unfinishedTransactions().then(async (transactions) => {
      for (const transaction of transactions) await sendTransaction(transaction);
    }, () => undefined);
    const sub = Store.addTransactionListener((transaction) => void sendTransaction(transaction));
    return () => sub.remove();
  }, [status]);
}
```

`src/app/(tabs)/_layout.tsx`: call `useStoreSync()` next to the other hooks.

`test/products.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { PRODUCTS, PRODUCT_IDS, isProductId, purchaseKey, sendOutcome, shouldFinish } from "../src/core/store/products.ts";

describe("products", () => {
  it("six products, each described", () => {
    expect(PRODUCT_IDS).toHaveLength(6);
    for (const id of PRODUCT_IDS) expect(PRODUCTS[id].id).toBe(id);
    expect(PRODUCTS["waypoint.credits.5000"]).toEqual({ id: "waypoint.credits.5000", kind: "pack", credits: 5000, period: null });
    expect(isProductId("waypoint.plus.yearly")).toBe(true);
    expect(isProductId("waypoint.plus")).toBe(false);
  });
  it("purchaseKey fits the Idempotency-Key rule", () => {
    expect(purchaseKey("2000000123456789")).toBe("apple_txn_2000000123456789");
    expect(purchaseKey("42")).toBe("apple_txn_000042");
    expect(purchaseKey("42")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(() => purchaseKey("12a")).toThrow();
    expect(() => purchaseKey("")).toThrow();
  });
  it("outcomes and finishing", () => {
    expect(sendOutcome(null)).toBe("granted");
    expect(sendOutcome({ status: 409, message: "purchase belongs to another account" })).toBe("other_account");
    expect(sendOutcome({ status: 409, message: "purchase was refunded" })).toBe("refunded");
    expect(sendOutcome({ status: 409, message: "request in progress" })).toBe("retry_later");
    expect(sendOutcome({ status: 400, message: "invalid purchase" })).toBe("invalid");
    expect(sendOutcome({ status: 401, message: "device signature required" })).toBe("retry_later");
    expect(sendOutcome({ status: 500, message: "something went wrong" })).toBe("retry_later");
    for (const outcome of ["granted", "other_account", "refunded"] as const) expect(shouldFinish(outcome)).toBe(true);
    expect(shouldFinish("invalid")).toBe(false);
    expect(shouldFinish("retry_later")).toBe(false);
  });
});
```

Checks without Xcode:
- `cd apps/mobile/modules/waypoint-store/ios && swiftc -typecheck StoreBridge.swift` prints nothing (StoreKit 2 is in the macOS SDK).
- `npx expo-modules-autolinking resolve --platform apple` lists `WaypointStoreModule`.
- Root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.
- Say in the pull request that `WaypointStoreModule.swift` was not compiled (no Xcode yet).

Device check (needs Xcode, the six products in App Store Connect, a Sandbox tester signed in under Settings › Developer › Sandbox Apple Account, the API with PR 17 and `APPLE_ENVIRONMENTS` including `Sandbox`). Use a scratch route that calls `loadProducts()` and `buy(...)`, deleted before merging; M17 builds the real screens.
1. `loadProducts()` returns six products with local prices.
2. Buy `waypoint.credits.1000`: the sandbox sheet shows; after paying, `buy` returns `granted` with `credits: 1000`, and `GET /v1/wallet` shows 1,000 more purchased credits. `Transaction.unfinished` is empty afterwards.
3. Buy again with Airplane Mode turned on right after the sheet closes: `saved`. Turn the network on and relaunch: the credits arrive once, and the transaction is finished.
4. Cancel the sheet: `cancelled`, nothing sent.
5. Sign in on a second iPhone with the same account but not approved (M27a step 4): `buy` opens "This iPhone needs approval" and the sandbox sheet never shows.
6. Buy Plus monthly: `plan: "plus"`; in sandbox it renews every few minutes and each renewal arrives through `onTransaction` and is sent.

Not in this PR: the Plans screens (M17), offer codes, introductory offers, refund requests from the app, subscription management screens (Apple's own page is linked in M17), StoreKit configuration files for Xcode testing.

---

### M17 · Plans bundle (`src/features/plans`): balance, Own it, Plus, credit packs, restore, out of credits

Branch `pr/m17-plans`. After M14 and M12. No new dependencies. Files, all under `apps/mobile/`: `src/core/store/plans.ts`, `src/platform/wallet.ts`, `src/features/plans/PlansScreen.tsx`, `src/app/plans.tsx`, `src/app/_layout.tsx` (one screen line), `src/features/settings/SettingsScreen.tsx` (one row), `test/plans.test.ts`.

Why it looks like this (O1–O14, cut to what the server has):
- One screen, `/plans`, for everything about money: the balance (`GET /v1/wallet`), credit packs, Plus, Own it, Restore purchases. "Out of credits" is the same screen opened with `?need=<shortfall>` (Explain's "Get credits", M15), with a line saying how many are missing. After buying, the person goes back and taps "Try again", which re-sends the same request with the same Idempotency-Key (`docs/architecture.md` section 4).
- Prices come from the App Store (`displayPrice`, in the person's currency), never from our code. Credit amounts come from `PRODUCTS` (M14), which matches the server.
- Wording a student understands: "yours to keep" for purchased credits (they never expire), "this month" for Plus's monthly credits.
- Apple requires subscription terms beside the Plus buttons; the footer has them.
- "Before you run it" (a quote sheet for tasks over a few credits) is not here: stage 2's only paid task is Explain at 1 to 4 credits with the price on the button. The quote sheet comes with the first long job (M18, M19).

`src/core/store/plans.ts`, exactly:

```ts
import type { WalletResponse } from "@waypoint/contracts";
import { creditsLabel } from "../config/config.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const digits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// "Dec 19" in the phone's time zone; offsetMinutes is -new Date().getTimezoneOffset().
export function shortDate(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

export type BalanceSummary = { total: string; detail: string; owed: string | null; renews: string | null };

export function balanceSummary(wallet: WalletResponse, offsetMinutes: number): BalanceSummary {
  const { monthly, purchased, owed, available } = wallet.balance;
  const keep = `${digits(purchased)} yours to keep`;
  return {
    total: creditsLabel(available),
    detail: wallet.plan === "plus" || monthly > 0 ? `${digits(monthly)} this month · ${keep}` : keep,
    owed: owed > 0 ? `${creditsLabel(owed)} owed after a refund. New credits pay this first.` : null,
    renews: wallet.plan === "plus" && wallet.monthly_resets_at !== null ? `Monthly credits renew on ${shortDate(wallet.monthly_resets_at, offsetMinutes)}.` : null,
  };
}

export function ownsOwnIt(wallet: WalletResponse): boolean {
  return wallet.entitlements.some((e) => e.product === "own_it" && e.ended_at === null);
}

// "You need 3 more credits for this." for /plans?need=3; null for anything that is not a whole number from 1 up.
export function needLine(need: string | undefined): string | null {
  if (need === undefined || !/^\d{1,7}$/.test(need) || Number(need) < 1) return null;
  return `You need ${creditsLabel(Number(need))} more for this.`;
}

export type BuyKind = "granted" | "pending" | "cancelled" | "not_ready" | "other_account" | "saved" | "failed";

// What the Plans screen says after a purchase. null: say nothing (cancelled, or another screen was opened).
export function buyMessage(kind: BuyKind, credits: number): string | null {
  switch (kind) {
    case "granted":
      return credits > 0 ? `Added ${creditsLabel(credits)}.` : "Done.";
    case "pending":
      return "Waiting for approval. If a parent needs to say yes, the credits arrive when they do.";
    case "saved":
      return "Paid. The credits arrive as soon as you're back online.";
    case "other_account":
      return "This purchase belongs to another Waypoint account.";
    case "failed":
      return "The purchase didn't go through. If you were charged, Waypoint keeps trying to add it.";
    case "cancelled":
    case "not_ready":
      return null;
  }
}

export function restoreMessage(count: number): string {
  return count === 0 ? "Nothing to restore." : `Restored ${count} ${count === 1 ? "purchase" : "purchases"}.`;
}
```

`src/platform/wallet.ts`, exactly:

```ts
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { WalletResponse } from "@waypoint/contracts";
import { NetworkError } from "@waypoint/api-client";
import { api } from "./api.ts";

export type WalletState = { wallet: WalletResponse | null; error: "offline" | "failed" | null; reload: () => void };

// GET /v1/wallet each time the screen comes into view, and on reload().
export function useWallet(): WalletState {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [error, setError] = useState<"offline" | "failed" | null>(null);
  const [version, setVersion] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      api.wallet().then(
        (w) => {
          if (!live) return;
          setWallet(w);
          setError(null);
        },
        (e: unknown) => {
          if (live) setError(e instanceof NetworkError ? "offline" : "failed");
        },
      );
      return () => {
        live = false;
      };
    }, [version]),
  );
  return { wallet, error, reload: () => setVersion((v) => v + 1) };
}
```

`src/features/plans/PlansScreen.tsx` (`/plans`, optional `need`). Copy written for this card; check it against O1–O14. Use `src/ui/kit.tsx` pieces, `useColors()`, and `Row` for each product.
- Top: back button (`chevron.left`, as in `SessionScreen`), then `Title` "Plans & credits".
- **Balance card** (`surface`, radius 16): from `useWallet()` and `balanceSummary(wallet, -new Date().getTimezoneOffset())`: `total` large (28, weight 700), `detail` as `Caption`, then `renews` and `owed` lines when not null (`owed` in `danger`). While loading: an `ActivityIndicator`. `error === "offline"`: "Can't show your balance offline." `"failed"`: "Couldn't load your balance." with a "Try again" text button calling `reload`.
- When `needLine(need)` is not null: a `flagSoft` box with that line, above the products.
- Products come from `loadProducts()` (M14), loaded once on mount. If it throws or returns none: "Purchases aren't available right now." and nothing else in the product sections.
- Section caption "CREDIT PACKS": one `Row` per `kind: "pack"` product: title `creditsLabel(info.credits)`, subtitle "Yours to keep. They never expire.", right accessory the `displayPrice` in an `accentSoft` pill.
- Section caption "PLUS": if `wallet.plan === "plus"`: one row "You have Plus" with subtitle "2,000 credits every month, zero retention, and audio and photo sync" and a right accessory "Manage", which opens `https://apps.apple.com/account/subscriptions` with `Linking.openURL`. Otherwise one row per Plus product: title "Plus monthly" / "Plus yearly", the same subtitle, the price pill.
- Section caption "OWN IT": if `ownsOwnIt(wallet)`: a row "You own it" with subtitle "2,000 credits came with it, once." Otherwise the Own it product: title "Own it", subtitle "2,000 credits once, and audio and photo sync. Pay once.", the price pill.
- Tapping a product row calls `buy(info.id)` (M14). While it runs, that row shows an `ActivityIndicator` instead of its price, and taps on any product row do nothing (check a `buying` state at the top of the handler; `Row` has no disabled prop). Afterwards show `buyMessage(result.kind, credits)` (credits from `result.reply.credits` when `granted`, else 0) in a banner under the balance card for 4 seconds, and call `reload()`.
- A text button "Restore purchases": `restorePurchases()`, then `restoreMessage(count)` in the same banner and `reload()`.
- Footer `Caption`s: "Plus renews automatically until you cancel it in Settings › Apple Account › Subscriptions. Payment is charged to your Apple Account." and `OnDeviceNote` "Recording, pages, flashcards, quizzes and search are free and stay on this iPhone. Credits are only for the cloud."

`src/app/plans.tsx` only re-exports the screen. `src/app/_layout.tsx`: inside the signed-in `Stack.Protected`, add `<Stack.Screen name="plans" />`. `src/features/settings/SettingsScreen.tsx` (M12): add a row "Plans & credits" (symbol `creditcard`) as the first row of a new section "ACCOUNT" under the account card, opening `/plans`. Change nothing else in that file.

`test/plans.test.ts`, exactly:

```ts
import type { WalletResponse } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { balanceSummary, buyMessage, needLine, ownsOwnIt, restoreMessage, shortDate } from "../src/core/store/plans.ts";

function wallet(over: Partial<WalletResponse> = {}, balance: Partial<WalletResponse["balance"]> = {}): WalletResponse {
  return {
    balance: { monthly: 0, purchased: 25, held: 0, owed: 0, available: 25, ...balance },
    monthly_resets_at: null,
    plan: "free",
    entitlements: [],
    ...over,
  };
}

describe("plans copy", () => {
  it("balance for a free account", () => {
    expect(balanceSummary(wallet(), 0)).toEqual({ total: "25 credits", detail: "25 yours to keep", owed: null, renews: null });
  });
  it("balance for Plus, with a renewal date and a balance owed", () => {
    const w = wallet({ plan: "plus", monthly_resets_at: Date.UTC(2026, 11, 19, 12) }, { monthly: 1500, purchased: 2000, available: 3500, owed: 40 });
    expect(balanceSummary(w, 0)).toEqual({
      total: "3,500 credits",
      detail: "1,500 this month · 2,000 yours to keep",
      owed: "40 credits owed after a refund. New credits pay this first.",
      renews: "Monthly credits renew on Dec 19.",
    });
  });
  it("shortDate uses the given offset", () => {
    expect(shortDate(Date.UTC(2026, 0, 1, 2), -180)).toBe("Dec 31");
    expect(shortDate(Date.UTC(2026, 0, 1, 2), 0)).toBe("Jan 1");
  });
  it("ownsOwnIt only for an open own_it entitlement", () => {
    const e = { product: "own_it", source: "purchase" as const, media_cap_gb: 3, granted_at: 1, ended_at: null };
    expect(ownsOwnIt(wallet({ entitlements: [e] }))).toBe(true);
    expect(ownsOwnIt(wallet({ entitlements: [{ ...e, ended_at: 5 }] }))).toBe(false);
    expect(ownsOwnIt(wallet())).toBe(false);
  });
  it("needLine", () => {
    expect(needLine("1")).toBe("You need 1 credit more for this.");
    expect(needLine("15")).toBe("You need 15 credits more for this.");
    for (const bad of [undefined, "0", "-1", "1.5", "abc", "99999999"]) expect(needLine(bad)).toBeNull();
  });
  it("buy and restore messages", () => {
    expect(buyMessage("granted", 1000)).toBe("Added 1,000 credits.");
    expect(buyMessage("granted", 0)).toBe("Done.");
    expect(buyMessage("cancelled", 0)).toBeNull();
    expect(buyMessage("not_ready", 0)).toBeNull();
    expect(buyMessage("pending", 0)).toMatch(/^Waiting for approval/);
    expect(restoreMessage(0)).toBe("Nothing to restore.");
    expect(restoreMessage(1)).toBe("Restored 1 purchase.");
    expect(restoreMessage(2)).toBe("Restored 2 purchases.");
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (as M14: products in App Store Connect, a Sandbox tester, the API):
1. Settings › Plans & credits shows "25 credits" and "25 yours to keep" on a new account, and the six products with prices.
2. Buy 1,000 credits: the row spins, then "Added 1,000 credits." and the balance reads 1,025.
3. Buy Plus monthly: the Plus section turns into "You have Plus"; the balance shows "this month"; "Manage" opens Apple's subscriptions page.
4. Delete and reinstall the app, sign in, Restore purchases: "Restored 1 purchase." (Plus), no extra credits.
5. Open `/plans?need=3` from a scratch link: "You need 3 credits more for this." shows.
6. With Ask to Buy on a child sandbox account: the pending message shows; after approval the credits arrive without opening the screen again.

Not in this PR: the quote sheet (M18, M19), the ledger history, upgrades and downgrades inside the app (Apple's sheet does them), promotional offers, the media cap screen, the iPad layout.

---

### M15 · Explain bundle, part A: tap a word, explain (streamed), `sent_log`, "Sent for this task only"

Branch `pr/m15-explain`. After M17 (its `/plans` route), M10b and M10c (merged), and the server's PR 14 and S1E (merged). No new dependencies. Files, all under `apps/mobile/`:
- `src/core/db/schema.ts` (migration 2 appended), `src/core/capture/segments.ts`, `src/core/explain/excerpt.ts`, `src/core/explain/explanations.ts`, `src/core/explain/sent.ts`, `src/core/explain/later.ts`, `src/core/cloud/failure.ts`;
- `src/platform/tasks.ts`, `src/ui/WordText.tsx`;
- `src/features/explain/useExplain.ts`, `src/features/explain/ExplainSheet.tsx`, `src/features/explain/CloudLine.tsx`, `src/app/explain.tsx`, `src/app/_layout.tsx` (one screen);
- `src/features/capture/SessionScreen.tsx`, `src/features/capture/RecordScreen.tsx`, `src/features/capture/useRecording.ts` (the edits below only);
- `test/explain.test.ts`, `test/failure.test.ts`, `test/migrate.test.ts` (version 1 → 2).

Why it looks like this (`docs/architecture.md` flow 1, D1–D3):
- The person taps a word in the transcript, live or in a saved recording. A sheet opens with the word. **Nothing is sent until they tap "Explain · 1 credit"**: a tap on a word is easy to make by accident, and every send costs a credit and sends text (owner question; the boards may show it sending at once). "Show what's sent" shows the exact excerpt first.
- The request is the word and about 54 seconds of transcript around it: the device segments overlapping 45 s before to 9 s after the tap, cut from the start to `TRANSCRIPT_MAX_CHARS` (4,000). Its JSON body is written to `sent_log` **before** it is sent (stage 2 rule 3), keyed by the request's Idempotency-Key, which is also the end of the server's activity id (`explain:<user>:<key>`), so M21 can match them.
- The answer streams in (M3), then the line "Sent for this task only" (standard) or "Not stored in the cloud" (zero retention) from `done.retention` (`docs/architecture.md` section 6).
- Failures map to one small set (`src/core/cloud/failure.ts`), each with copy and actions: out of credits (shortfall, "Get credits" opens `/plans?need=N`, then "Try again" with the **same** key); model failed (nothing charged; "Try again" with a **new** key, or "Ask later"); offline ("Ask later" keeps the question as a flag for M33); zero retention on (403); this iPhone not approved; signed out.
- Tables `explanations`, `terms` and `sent_log` (`docs/architecture.md` section 5) arrive together in migration 2, so M16 adds none. In this card every explanation is discarded when the sheet closes (Save is M16); `sent_log` rows stay. Deleting a session deletes its explanations, terms and `sent_log` rows (cascade): its text is gone from the phone.
- The session screen did not list a recording's transcript yet (M10c left it out); it does now, with tappable words.

`src/core/db/schema.ts`: append this entry to `MIGRATIONS` after version 1, exactly (checked on `node:sqlite`, including the cascades):

```ts
  {
    version: 2,
    sql: `
CREATE TABLE explanations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  term TEXT NOT NULL CHECK (length(term) BETWEEN 1 AND 100),
  thread TEXT NOT NULL DEFAULT '[]',
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX explanations_session ON explanations (session_id, t);

CREATE TABLE terms (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  explanation_id TEXT NOT NULL UNIQUE REFERENCES explanations (id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sent_log (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK (task IN ('explain', 'more_detail', 'double_check', 'read_link', 'research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  sent TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  credits INTEGER CHECK (credits >= 0),
  retention TEXT CHECK (retention IN ('standard', 'zero')),
  at INTEGER NOT NULL
);
CREATE INDEX sent_log_at ON sent_log (at);
`,
  },
```

`test/migrate.test.ts`: the first test becomes "a new database ends at version 2, and a second run changes nothing", with its three `1`s changed to `2`. Change nothing else there.

`src/core/capture/segments.ts`, exactly:

```ts
import type { SqlDb } from "../db/sql.ts";

export type SegmentLine = { tStart: number; tEnd: number; text: string };

// The on-device transcript of a session, in time order.
export function listSegments(db: SqlDb, sessionId: string): SegmentLine[] {
  return db.all<SegmentLine>(
    "SELECT t_start AS tStart, t_end AS tEnd, text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start",
    [sessionId],
  );
}
```

`src/core/explain/excerpt.ts`, exactly. (No `\p{…}` classes: Hermes support for them is not relied on.)

```ts
import { TRANSCRIPT_MAX_CHARS, WORD_MAX_CHARS } from "@waypoint/contracts";
import type { SegmentLine } from "../capture/segments.ts";

// About 54 seconds of transcript around the tapped word: 45 s before it, 9 s after (docs/architecture.md flow 1).
export const EXCERPT_BEFORE_MS = 45_000;
export const EXCERPT_AFTER_MS = 9_000;

// The text of every segment that overlaps [t − 45 s, t + 9 s], in time order, with spaces collapsed. When it is longer
// than maxChars, words are dropped from the start, so the end (where the word was said) is kept.
export function excerptAround(segments: SegmentLine[], t: number, maxChars: number = TRANSCRIPT_MAX_CHARS): string {
  const from = t - EXCERPT_BEFORE_MS;
  const to = t + EXCERPT_AFTER_MS;
  const text = segments
    .filter((s) => s.tEnd >= from && s.tStart <= to)
    .sort((a, b) => a.tStart - b.tStart)
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars);
  const space = cut.indexOf(" ");
  return space === -1 ? cut : cut.slice(space + 1);
}

export type Token = { text: string; word: string | null };

const EDGE = /^[\s"'“”‘’()[\]{}.,;:!?…—–-]+|[\s"'“”‘’()[\]{}.,;:!?…—–-]+$/g;

// The tappable word inside a token: punctuation trimmed from both ends; null when nothing is left or it is too long.
export function cleanWord(token: string): string | null {
  const word = token.replace(EDGE, "");
  return word === "" || word.length > WORD_MAX_CHARS ? null : word;
}

// Splits a line into tokens that keep every character, so joining their text gives the line back.
export function splitWords(line: string): Token[] {
  return (line.match(/\S+|\s+/g) ?? []).map((text) => ({ text, word: /^\s+$/.test(text) ? null : cleanWord(text) }));
}
```

`src/core/explain/explanations.ts`, exactly:

```ts
import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";

type Deps = { now: () => number; newId: () => string };

const ThreadItemSchema = z.strictObject({
  kind: z.enum(["explain", "more_detail", "double_check"]),
  text: z.string(),
  at: z.number().int(),
  retention: z.enum(["standard", "zero"]),
  sentId: z.string().min(1), // the sent_log id, which is the request's Idempotency-Key
});
const ThreadSchema = z.array(ThreadItemSchema);

export type ThreadItem = z.infer<typeof ThreadItemSchema>;
export type Explanation = { id: string; sessionId: string; t: number; term: string; thread: ThreadItem[]; saved: boolean; createdAt: number };

type Row = { id: string; session_id: string; t: number; term: string; thread: string; saved: number; created_at: number };

function fromRow(row: Row): Explanation {
  const thread = ThreadSchema.parse(JSON.parse(row.thread));
  return { id: row.id, sessionId: row.session_id, t: row.t, term: row.term, thread, saved: row.saved === 1, createdAt: row.created_at };
}

export function getExplanation(db: SqlDb, id: string): Explanation | null {
  const row = db.get<Row>("SELECT id, session_id, t, term, thread, saved, created_at FROM explanations WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

// A new, unsaved explanation with an empty thread.
export function startExplanation(db: SqlDb, deps: Deps, sessionId: string, t: number, term: string): Explanation {
  const id = deps.newId();
  db.run("INSERT INTO explanations (id, session_id, t, term, created_at) VALUES (?, ?, ?, ?, ?)", [id, sessionId, Math.max(0, Math.round(t)), term, deps.now()]);
  const made = getExplanation(db, id);
  if (made === null) throw new Error("explanation missing after insert");
  return made;
}

export function addToThread(db: SqlDb, id: string, item: ThreadItem): Explanation {
  const current = getExplanation(db, id);
  if (current === null) throw new Error("no such explanation");
  const thread = [...current.thread, ThreadItemSchema.parse(item)];
  db.run("UPDATE explanations SET thread = ? WHERE id = ?", [JSON.stringify(thread), id]);
  return { ...current, thread };
}

// Closing the sheet keeps only saved explanations. sent_log rows stay: they record what left the phone.
export function discardIfUnsaved(db: SqlDb, id: string): void {
  db.run("DELETE FROM explanations WHERE id = ? AND saved = 0", [id]);
}
```

`src/core/explain/sent.ts`, exactly:

```ts
import type { SqlDb } from "../db/sql.ts";

export type SentTask = "explain" | "more_detail" | "double_check";

// UTF-8 length without TextEncoder, so it runs the same in Node and Hermes.
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// Written before the request is sent, with exactly the JSON body the API client sends (JSON.stringify of the request).
// id is the request's Idempotency-Key; logging the same key again changes nothing (a "Try again" with the same key).
export function logSent(db: SqlDb, entry: { id: string; task: SentTask; sessionId: string | null; body: unknown; at: number }): void {
  const sent = JSON.stringify(entry.body);
  db.run("INSERT OR IGNORE INTO sent_log (id, task, session_id, sent, bytes, at) VALUES (?, ?, ?, ?, ?, ?)", [
    entry.id,
    entry.task,
    entry.sessionId,
    sent,
    utf8Length(sent),
    entry.at,
  ]);
}

// After the reply: the credits charged (0 when the task failed) and the route's retention when known.
export function settleSent(db: SqlDb, id: string, credits: number, retention: "standard" | "zero" | null): void {
  db.run("UPDATE sent_log SET credits = ?, retention = ? WHERE id = ?", [credits, retention, id]);
}

export type SentEntry = { id: string; task: string; sessionId: string | null; sent: string; bytes: number; credits: number | null; retention: "standard" | "zero" | null; at: number };

export function getSent(db: SqlDb, id: string): SentEntry | null {
  return db.get<SentEntry>("SELECT id, task, session_id AS sessionId, sent, bytes, credits, retention, at FROM sent_log WHERE id = ?", [id]);
}
```

`src/core/explain/later.ts`, exactly:

```ts
import type { SqlDb } from "../db/sql.ts";

// Offline (or after a failed answer): keep the question as a flag at that moment. Answering flags is M33.
export function askLater(db: SqlDb, deps: { newId: () => string }, sessionId: string, t: number, word: string): void {
  db.run("INSERT INTO flags (id, session_id, t, question) VALUES (?, ?, ?, ?)", [deps.newId(), sessionId, Math.max(0, Math.round(t)), `What does "${word}" mean?`]);
}
```

`src/core/cloud/failure.ts`, exactly (copy written for this card; check it against D1–D8):

```ts
// Why a cloud task did not give an answer, as the screens need it. src/platform/tasks.ts turns API client errors into
// FailureInput; this file decides what it means.
export type FailureInput =
  | { kind: "api"; status: number; code: string; message: string; shortfall: number | null }
  | { kind: "network" }
  | { kind: "not_registered" }
  | { kind: "bad_reply" };

export type CloudFailure =
  | { kind: "out_of_credits"; shortfall: number }
  | { kind: "zero_retention" }
  | { kind: "model_failed" }
  | { kind: "already_finished" }
  | { kind: "busy" }
  | { kind: "offline" }
  | { kind: "device" }
  | { kind: "signed_out" }
  | { kind: "failed" };

export function classifyFailure(input: FailureInput): CloudFailure {
  if (input.kind === "network") return { kind: "offline" };
  if (input.kind === "not_registered") return { kind: "device" };
  if (input.kind === "bad_reply") return { kind: "failed" };
  const { status, code, message } = input;
  if (status === 402 && input.shortfall !== null) return { kind: "out_of_credits", shortfall: input.shortfall };
  if (status === 403 && code === "forbidden") return { kind: "zero_retention" };
  if (status === 401) return message === "device signature required" ? { kind: "device" } : { kind: "signed_out" };
  if (status === 409 && message === "request already finished") return { kind: "already_finished" };
  if (status === 409 || status === 429) return { kind: "busy" };
  if (status === 200 || message === "model unavailable") return { kind: "model_failed" }; // 200: an "error" event in the stream
  return { kind: "failed" };
}

// Whether "Try again" may re-send with the same Idempotency-Key. Out of credits: the hold was never made, so the same
// request runs after a purchase. A failed or finished answer needs a new key (docs/architecture.md section 4).
export function keepsKey(failure: CloudFailure): boolean {
  return failure.kind === "out_of_credits" || failure.kind === "busy" || failure.kind === "offline" || failure.kind === "device" || failure.kind === "signed_out";
}

export type FailureAction = "try_again" | "get_credits" | "ask_later" | "approve_device" | "close";
export type FailureCopy = { title: string; body: string; actions: FailureAction[] };

export function failureCopy(failure: CloudFailure): FailureCopy {
  switch (failure.kind) {
    case "out_of_credits":
      return {
        title: "Out of credits",
        body: `You need ${failure.shortfall} more ${failure.shortfall === 1 ? "credit" : "credits"} for this. Get credits, then try again.`,
        actions: ["get_credits", "try_again"],
      };
    case "zero_retention":
      return {
        title: "Zero retention is on",
        body: "No cloud model that keeps nothing is available yet, so cloud tasks can't run. Turn zero retention off in Settings › Cloud & privacy to use this.",
        actions: ["close"],
      };
    case "model_failed":
      return { title: "Couldn't get an answer", body: "Nothing was charged. You can try again, or keep it as a question for later.", actions: ["try_again", "ask_later"] };
    case "already_finished":
      return { title: "That request already finished", body: "Try again to ask once more.", actions: ["try_again"] };
    case "busy":
      return { title: "Still working on it", body: "Your last request hasn't finished yet. Try again in a moment.", actions: ["try_again"] };
    case "offline":
      return { title: "You're offline", body: "Keep this as a question for later, and get the answer when you're back online.", actions: ["ask_later", "try_again"] };
    case "device":
      return { title: "This iPhone isn't ready", body: "It needs to be set up before it can use credits.", actions: ["approve_device"] };
    case "signed_out":
      return { title: "Sign in again", body: "Your sign-in has ended. Sign in again to use the cloud.", actions: ["close"] };
    case "failed":
      return { title: "Something went wrong", body: "Try again in a moment.", actions: ["try_again"] };
  }
}
```

`src/platform/tasks.ts`, exactly:

```ts
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "@waypoint/api-client";
import type { ExplainRequest, StreamDone } from "@waypoint/contracts";
import { classifyFailure, type CloudFailure } from "../core/cloud/failure.ts";
import { api } from "./api.ts";

// Paid instant tasks (PR 14, 15). Features call these; only src/platform talks to the API client.
export function streamExplain(request: ExplainRequest, key: string, onDelta: (text: string) => void): Promise<StreamDone> {
  return api.explain(request, { key, onDelta });
}

export function toFailure(error: unknown): CloudFailure {
  if (error instanceof ApiCallError) {
    return classifyFailure({ kind: "api", status: error.status, code: error.code, message: error.message, shortfall: error.shortfall });
  }
  if (error instanceof NetworkError) return classifyFailure({ kind: "network" });
  if (error instanceof NotRegisteredError) return classifyFailure({ kind: "not_registered" });
  if (error instanceof BadReplyError) return classifyFailure({ kind: "bad_reply" });
  return { kind: "failed" };
}
```

`src/ui/WordText.tsx`, exactly. Nested `Text` with `onPress` keeps the line wrapping as one paragraph:

```tsx
import { Text, type StyleProp, type TextStyle } from "react-native";
import { splitWords } from "../core/explain/excerpt.ts";

// A transcript line whose words can be tapped (D1). Spaces and punctuation are plain text.
export function WordText({ text, style, onWord }: { text: string; style?: StyleProp<TextStyle>; onWord: (word: string) => void }) {
  return (
    <Text style={style} accessibilityHint="Tap a word to explain it">
      {splitWords(text).map((token, index) =>
        token.word === null ? (
          token.text
        ) : (
          <Text key={index} onPress={() => onWord(token.word ?? "")} suppressHighlighting={false}>
            {token.text}
          </Text>
        ),
      )}
    </Text>
  );
}
```

`src/features/explain/useExplain.ts`, exactly:

```ts
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest } from "@waypoint/contracts";
import { listSegments } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround } from "../../core/explain/excerpt.ts";
import { addToThread, discardIfUnsaved, startExplanation, type Explanation } from "../../core/explain/explanations.ts";
import { askLater } from "../../core/explain/later.ts";
import { logSent, settleSent } from "../../core/explain/sent.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { streamExplain, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

export type ExplainPhase =
  | { kind: "ready" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string; retention: "standard" | "zero"; credits: number; sentId: string }
  | { kind: "failed"; failure: CloudFailure; text: string };

// One tapped word: the excerpt around it, the request, and what came back. The Idempotency-Key is made when the person
// taps Explain and kept for a "Try again" only when the request did not run (keepsKey).
export function useExplain(sessionId: string, t: number, word: string) {
  const [excerpt] = useState(() => excerptAround(listSegments(getDb(), sessionId), t));
  const [phase, setPhase] = useState<ExplainPhase>({ kind: "ready" });
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [askedLater, setAskedLater] = useState(false);
  const key = useRef<string | null>(null);
  const idRef = useRef<string | null>(null);

  // Closing the sheet keeps only saved explanations (M16 adds Save).
  useEffect(
    () => () => {
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    },
    [],
  );

  async function explain(): Promise<void> {
    if (excerpt === "" || phase.kind === "streaming") return;
    if (!requireApprovedDevice()) return;
    const requestKey = key.current ?? randomUUID();
    key.current = requestKey;
    const request: ExplainRequest = { word, transcript: excerpt };
    writeDb((db) => logSent(db, { id: requestKey, task: "explain", sessionId, body: request, at: Date.now() }));
    let text = "";
    setPhase({ kind: "streaming", text });
    try {
      const done = await streamExplain(request, requestKey, (piece) => {
        text += piece;
        setPhase({ kind: "streaming", text });
      });
      const saved = writeDb((db) => {
        settleSent(db, requestKey, done.credits, done.retention);
        const id = idRef.current ?? startExplanation(db, deps, sessionId, t, word).id;
        idRef.current = id;
        return addToThread(db, id, { kind: "explain", text, at: Date.now(), retention: done.retention, sentId: requestKey });
      });
      key.current = null;
      setExplanation(saved);
      setPhase({ kind: "done", text, retention: done.retention, credits: done.credits, sentId: requestKey });
    } catch (error) {
      const failure = toFailure(error);
      if (!keepsKey(failure)) {
        writeDb((db) => settleSent(db, requestKey, 0, null));
        key.current = null;
      }
      setPhase({ kind: "failed", failure, text });
    }
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word));
    setAskedLater(true);
  }

  return { excerpt, phase, explanation, askedLater, explain, saveForLater };
}
```

`src/features/explain/CloudLine.tsx`, exactly:

```tsx
import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// The line under every cloud answer (docs/architecture.md section 6, "What is kept, by route").
export function CloudLine({ retention, onPress }: { retention: "standard" | "zero"; onPress?: () => void }) {
  const colors = useColors();
  const text = retention === "zero" ? "Not stored in the cloud" : "Sent for this task only";
  return (
    <Pressable accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={text} disabled={onPress === undefined} onPress={onPress} style={styles.row}>
      <SymbolView name="cloud" tintColor={colors.cloud} size={14} />
      <Text style={[styles.text, { color: colors.cloudInk }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontSize: 13, fontWeight: "500" },
});
```

`src/features/explain/ExplainSheet.tsx`, exactly:

```tsx
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel, priceOf } from "../../core/config/config.ts";
import { formatOffset } from "../../core/format.ts";
import { useConfig } from "../../platform/config.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { CloudLine } from "./CloudLine.tsx";
import { useExplain } from "./useExplain.ts";

// D1–D3: a tapped word, explained by the cloud. Opened as a sheet over the recording or the session.
export default function ExplainSheet() {
  const params = useLocalSearchParams<{ sessionId: string; t: string; word: string }>();
  const t = Number(params.t);
  return <ExplainBody sessionId={params.sessionId} t={Number.isFinite(t) ? t : 0} word={params.word.slice(0, 100)} />;
}

function ExplainBody({ sessionId, t, word }: { sessionId: string; t: number; word: string }) {
  const colors = useColors();
  const config = useConfig();
  const model = useExplain(sessionId, t, word);
  const [showSent, setShowSent] = useState(false);
  const price = priceOf(config, "explain") ?? 1;
  const phase = model.phase;

  function act(action: FailureAction): void {
    if (action === "try_again") void model.explain();
    else if (action === "get_credits" && phase.kind === "failed" && phase.failure.kind === "out_of_credits") router.push(`/plans?need=${phase.failure.shortfall}`);
    else if (action === "ask_later") model.saveForLater();
    else if (action === "approve_device") router.push("/device-waiting");
    else router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Title>{word}</Title>
      <Caption>{`At ${formatOffset(t)} in this recording`}</Caption>

      {phase.kind === "ready" ? (
        <>
          {model.excerpt === "" ? (
            <Body>There isn't enough of the transcript around this word yet.</Body>
          ) : (
            <>
              <Body style={{ color: colors.ink2 }}>Waypoint sends this word and about a minute of the transcript around it, for this task only.</Body>
              <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)}>
                <Text style={[styles.link, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
              </Pressable>
              {showSent ? <Text style={[styles.sent, { color: colors.ink3, backgroundColor: colors.surface2 }]}>{model.excerpt}</Text> : null}
              <PrimaryButton label={`Explain · ${creditsLabel(price)}`} icon="sparkle.magnifyingglass" onPress={() => void model.explain()} />
            </>
          )}
        </>
      ) : null}

      {phase.kind === "streaming" ? (
        <View style={styles.answer}>
          {phase.text === "" ? <ActivityIndicator /> : <Body>{phase.text}</Body>}
          <Caption>Explaining…</Caption>
        </View>
      ) : null}

      {phase.kind === "done" ? (
        <View style={styles.answer}>
          <Body>{phase.text}</Body>
          <CloudLine retention={phase.retention} />
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      ) : null}

      {phase.kind === "failed" ? (
        <View style={styles.answer}>
          {phase.text !== "" ? <Body style={{ color: colors.ink3 }}>{phase.text}</Body> : null}
          <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
            <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{failureCopy(phase.failure).title}</Text>
            <Text style={[styles.boxBody, { color: colors.flagInk }]}>{failureCopy(phase.failure).body}</Text>
          </View>
          {model.askedLater ? <Caption>Saved as a question for later.</Caption> : null}
          {failureCopy(phase.failure).actions.map((action, index) =>
            action === "ask_later" && model.askedLater ? null : index === 0 ? (
              <PrimaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
            ) : (
              <SecondaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
            ),
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const ACTION_LABELS: Record<FailureAction, string> = {
  try_again: "Try again",
  get_credits: "Get credits",
  ask_later: "Ask later",
  approve_device: "Set up this iPhone",
  close: "Close",
};

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  answer: { gap: 14 },
  link: { fontSize: 15, fontWeight: "600" },
  sent: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 12 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
```

`src/app/explain.tsx`: `export { default } from "../features/explain/ExplainSheet.tsx";`. `src/app/_layout.tsx`, inside the signed-in `Stack.Protected` (react-native-screens 4.30 and expo-router 58 take these options; checked in their types):

```tsx
        <Stack.Screen
          name="explain"
          options={{ presentation: "formSheet", sheetAllowedDetents: [0.4, 0.75, 1], sheetInitialDetentIndex: 0, sheetGrabberVisible: true }}
        />
```

Capture edits (a feature may not import another feature, so capture opens Explain by route):
- `useRecording.ts`: add `sessionId: string | null;` to `RecordingModel` after `phase`, and `sessionId: sessionRef.current?.id ?? null,` to the returned object after `phase,`.
- `RecordScreen.tsx`: import `WordText` from `../../ui/WordText.tsx`. Pass `sessionId={model.sessionId}` to each `TimelineRow`; give `TimelineRow` a `sessionId: string | null` prop; in its `"line"` case replace the line's `<Text style={[styles.lineText, { color: colors.ink }]}>{item.text}</Text>` with `<WordText text={item.text} style={[styles.lineText, { color: colors.ink }]} onWord={(word) => { if (sessionId !== null) router.push({ pathname: "/explain", params: { sessionId, t: String(item.at), word } }); }} />`. The volatile (not yet final) line stays plain text.
- `SessionScreen.tsx`: replace the comment "Recording transcripts are not listed yet (see the pull request)." with "A recording's transcript lists its lines; tapping a word opens Explain (M15)."; add `segments: session.kind === "recording" ? listSegments(db, id) : []` to the `useQuery` result; before the pages, render each segment as a row: `formatOffset(tStart)` (width 48, `ink3`, size 13, tabular numbers) and a `WordText` (size 17, line height 25, `ink`) whose `onWord` pushes `{ pathname: "/explain", params: { sessionId: id, t: String(segment.tStart), word } }`. Add the three styles `line`, `time`, `lineText` for that.

`test/explain.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { listSegments } from "../src/core/capture/segments.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { addToThread, discardIfUnsaved, getExplanation, startExplanation, type ThreadItem } from "../src/core/explain/explanations.ts";
import { cleanWord, excerptAround, splitWords } from "../src/core/explain/excerpt.ts";
import { askLater } from "../src/core/explain/later.ts";
import { getSent, logSent, settleSent, utf8Length } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  return { db, deps };
}

const seg = (tStart: number, text: string) => ({ tStart, tEnd: tStart + 4_000, text });

describe("excerptAround", () => {
  const lines = [seg(0, "first"), seg(56_000, "before"), seg(100_000, "word here"), seg(108_000, "just after"), seg(120_000, "too late")];
  it("keeps segments overlapping 45 s before to 9 s after, in time order", () => {
    expect(excerptAround([...lines].reverse(), 100_000)).toBe("before word here just after");
  });
  it("collapses spaces and returns '' when nothing is near", () => {
    expect(excerptAround([seg(0, "  a \n b ")], 1_000)).toBe("a b");
    expect(excerptAround(lines, 500_000)).toBe("");
  });
  it("cuts from the start at a word boundary to fit", () => {
    expect(excerptAround([seg(0, "aaa bbb ccc ddd")], 0, 9)).toBe("ccc ddd");
    expect(excerptAround([seg(0, "abcdefghij")], 0, 4)).toBe("ghij");
  });
});

describe("words", () => {
  it("splitWords keeps every character and finds the words", () => {
    const tokens = splitWords("Photosynthesis, in “plants”!");
    expect(tokens.map((t) => t.text).join("")).toBe("Photosynthesis, in “plants”!");
    expect(tokens.filter((t) => t.word !== null).map((t) => t.word)).toEqual(["Photosynthesis", "in", "plants"]);
    expect(splitWords("")).toEqual([]);
  });
  it("cleanWord", () => {
    expect(cleanWord("(mitochondria).")).toBe("mitochondria");
    expect(cleanWord("—")).toBeNull();
    expect(cleanWord("x".repeat(101))).toBeNull();
    expect(cleanWord("don't")).toBe("don't");
  });
});

describe("explanations and sent_log", () => {
  it("lists device segments in order", () => {
    const { db } = setup();
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 5000, 6000, 'b', 'device'), ('s1', 1000, 2000, 'a', 'device'), ('s1', 1000, 2000, 'c', 'cloud')");
    expect(listSegments(db, "s1")).toEqual([{ tStart: 1000, tEnd: 2000, text: "a" }, { tStart: 5000, tEnd: 6000, text: "b" }]);
  });
  it("start, add to the thread, discard unless saved", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 1234.6, "osmosis");
    expect(e).toMatchObject({ sessionId: "s1", t: 1235, term: "osmosis", thread: [], saved: false, createdAt: 1_000 });
    const item: ThreadItem = { kind: "explain", text: "Water moves.", at: 2_000, retention: "standard", sentId: "key_1" };
    expect(addToThread(db, e.id, item).thread).toEqual([item]);
    expect(getExplanation(db, e.id)?.thread).toEqual([item]);
    discardIfUnsaved(db, e.id);
    expect(getExplanation(db, e.id)).toBeNull();
  });
  it("a corrupt thread throws", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    db.run("UPDATE explanations SET thread = '[{\"kind\":\"other\"}]' WHERE id = ?", [e.id]);
    expect(() => getExplanation(db, e.id)).toThrow();
  });
  it("logSent stores the exact body once, settleSent adds credits and retention", () => {
    const { db } = setup();
    const body = { word: "café", transcript: "un café" };
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body, at: 5 });
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body: { word: "other", transcript: "x" }, at: 6 });
    expect(getSent(db, "key_1")).toEqual({ id: "key_1", task: "explain", sessionId: "s1", sent: JSON.stringify(body), bytes: 40, credits: null, retention: null, at: 5 });
    settleSent(db, "key_1", 1, "standard");
    expect(getSent(db, "key_1")).toMatchObject({ credits: 1, retention: "standard" });
    expect(getSent(db, "nope")).toBeNull();
  });
  it("utf8Length", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
  });
  it("deleting the session removes explanations, terms and sent_log rows", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    db.run("INSERT INTO terms (id, session_id, explanation_id, term, meaning, created_at) VALUES ('t1', 's1', ?, 'x', 'm', 1)", [e.id]);
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body: {}, at: 1 });
    db.run("DELETE FROM sessions WHERE id = 's1'");
    expect(db.get<{ n: number }>("SELECT (SELECT count(*) FROM explanations) + (SELECT count(*) FROM terms) + (SELECT count(*) FROM sent_log) AS n")?.n).toBe(0);
  });
  it("askLater adds a flag with the question", () => {
    const { db, deps } = setup();
    askLater(db, deps, "s1", 4_200.4, "osmosis");
    expect(db.get<{ t: number; question: string; state: string }>("SELECT t, question, state FROM flags")).toEqual({ t: 4200, question: 'What does "osmosis" mean?', state: "open" });
  });
});
```

`test/failure.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { classifyFailure, failureCopy, keepsKey, type CloudFailure } from "../src/core/cloud/failure.ts";

const api = (status: number, code: string, message: string, shortfall: number | null = null) => ({ kind: "api" as const, status, code, message, shortfall });

describe("classifyFailure", () => {
  it("maps every server answer the tasks give", () => {
    expect(classifyFailure(api(402, "insufficient_credits", "not enough credits", 3))).toEqual({ kind: "out_of_credits", shortfall: 3 });
    expect(classifyFailure(api(403, "forbidden", "no zero-retention route for this task"))).toEqual({ kind: "zero_retention" });
    expect(classifyFailure(api(401, "unauthorized", "device signature required"))).toEqual({ kind: "device" });
    expect(classifyFailure(api(401, "unauthorized", "sign in required"))).toEqual({ kind: "signed_out" });
    expect(classifyFailure(api(409, "conflict", "request already finished"))).toEqual({ kind: "already_finished" });
    expect(classifyFailure(api(409, "conflict", "request in progress"))).toEqual({ kind: "busy" });
    expect(classifyFailure(api(429, "rate_limited", "slow down"))).toEqual({ kind: "busy" });
    expect(classifyFailure(api(500, "internal", "model unavailable"))).toEqual({ kind: "model_failed" });
    expect(classifyFailure(api(200, "internal", "model failed"))).toEqual({ kind: "model_failed" });
    expect(classifyFailure(api(500, "internal", "config unavailable"))).toEqual({ kind: "failed" });
    expect(classifyFailure(api(400, "bad_request", "invalid request"))).toEqual({ kind: "failed" });
    expect(classifyFailure({ kind: "network" })).toEqual({ kind: "offline" });
    expect(classifyFailure({ kind: "not_registered" })).toEqual({ kind: "device" });
    expect(classifyFailure({ kind: "bad_reply" })).toEqual({ kind: "failed" });
  });
});

describe("keys and copy", () => {
  const all: CloudFailure[] = [
    { kind: "out_of_credits", shortfall: 1 }, { kind: "zero_retention" }, { kind: "model_failed" }, { kind: "already_finished" },
    { kind: "busy" }, { kind: "offline" }, { kind: "device" }, { kind: "signed_out" }, { kind: "failed" },
  ];
  it("only a request that did not run keeps its key", () => {
    expect(all.filter(keepsKey).map((f) => f.kind)).toEqual(["out_of_credits", "busy", "offline", "device", "signed_out"]);
  });
  it("every failure has copy and at least one action", () => {
    for (const f of all) expect(failureCopy(f).actions.length).toBeGreaterThan(0);
    expect(failureCopy({ kind: "out_of_credits", shortfall: 1 }).body).toBe("You need 1 more credit for this. Get credits, then try again.");
    expect(failureCopy({ kind: "model_failed" }).actions).toEqual(["try_again", "ask_later"]);
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test` (the boundary test included), `npm run export:ios -w @waypoint/mobile`. All of this card's code, with M13 to M17, was type-checked and bundled together here.

Device check (needs Xcode, an approved iPhone (M27a), the API with PR 14 and a Workers AI route):
1. Record 2 minutes with a few science words. Tap a word in the live transcript: the sheet opens at the low detent over the recording, which keeps recording. "Show what's sent" shows about a minute of text ending near the word. "Explain · 1 credit" streams an answer, then "Sent for this task only". Close; the recording is still going.
2. Open the saved session: the transcript lines show; tapping a word opens the same sheet.
3. With 0 credits: "Out of credits", "You need 1 more credit…"; "Get credits" opens Plans with that line; buy 1,000 credits; back; "Try again" answers and only 1 credit is charged (`GET /v1/wallet`).
4. Airplane Mode: "You're offline"; "Ask later" adds a `flags` row with the question (check in a debug build; M33 shows them).
5. On a phone still waiting for approval: "Explain" opens "This iPhone needs approval" and nothing is sent (no `sent_log` row).
6. Delete the session: its `sent_log` rows are gone.

Not in this PR: more detail, double-check, Save, "What was sent" (M16), answering flags (M33), Explain on page text, the "offer research" button (`offer_research`, M19), VoiceOver per-word actions (each line reads as one paragraph).

---

### M16 · Explain bundle, part B: more detail, double-check, the thread, save, "What was sent"

Branch `pr/m16-explain-more`. After M15 (and the server's PR 15, merged). No new dependencies. Files, all under `apps/mobile/`: `src/core/explain/explanations.ts` (additions), `src/core/explain/sent.ts` (additions), `src/platform/tasks.ts` (additions), `src/features/explain/useExplain.ts` (replaced), `src/features/explain/ExplainSheet.tsx` (replaced), `src/features/explain/SentScreen.tsx`, `src/app/sent.tsx`, `src/app/_layout.tsx` (one screen), `test/explain-thread.test.ts`.

Why it looks like this (D4–D8):
- After an explanation, two follow-ups: **More detail** (streamed, 3 credits) and **Double-check** (one JSON reply, 4 credits). Both send the word, the same excerpt and "the explanation shown" (`docs/architecture.md` section 4; `FollowUpRequestSchema`), which is the latest "explain" item in the thread. Each has its own Idempotency-Key with the same keep-or-renew rule as M15.
- The answers form a thread under the word, each with its cloud line. Double-check starts with "Correct", "Partly correct" or "Not correct" (the server's prompt asks for that line); the app tints the answer's edge `local`, `flag` or `danger` when it finds one, and shows it plainly when it does not.
- **Save** keeps the explanation after the sheet closes and adds the word to `terms` with the first answer as its meaning (for flashcards later). Unsaved explanations are discarded when the sheet closes; `sent_log` keeps the record of what was sent either way.
- Tapping a cloud line opens **What was sent** (`/sent?id=<key>`): the task, the date, what it cost ("Not charged" when it failed), and each field of the exact body that left the phone (Word, Transcript, Explanation, and any other field as it is). It is a route, so Settings (M21) can open it too.
- The prices on the buttons come from the live price table (M13), with the architecture's prices as the fallback.

`src/core/explain/explanations.ts`: append exactly:

```ts
// Save keeps the explanation after the sheet closes and adds the word to the session's terms, with the first answer
// as its meaning. Saving twice changes nothing.
export function saveExplanation(db: SqlDb, deps: Deps, id: string): void {
  const e = getExplanation(db, id);
  if (e === null) throw new Error("no such explanation");
  const first = e.thread.find((item) => item.kind === "explain");
  if (first === undefined) throw new Error("nothing to save yet");
  db.transaction(() => {
    db.run("UPDATE explanations SET saved = 1 WHERE id = ?", [id]);
    db.run("INSERT OR IGNORE INTO terms (id, session_id, explanation_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      deps.newId(),
      e.sessionId,
      id,
      e.term,
      first.text,
      deps.now(),
    ]);
  });
}

export function unsaveExplanation(db: SqlDb, id: string): void {
  db.transaction(() => {
    db.run("DELETE FROM terms WHERE explanation_id = ?", [id]);
    db.run("UPDATE explanations SET saved = 0 WHERE id = ?", [id]);
  });
}

// The explanation the person is looking at: what more detail and double-check send as "answer".
export function shownAnswer(e: Explanation): string | null {
  for (let i = e.thread.length - 1; i >= 0; i--) {
    const item = e.thread[i];
    if (item !== undefined && item.kind === "explain") return item.text;
  }
  return null;
}

// Double-check answers start with one line: Correct, Partly correct, or Not correct (apps/api/src/tasks/double-check.ts).
export function verdictOf(text: string): "correct" | "partly" | "not" | null {
  const first = (text.split("\n")[0] ?? "").trim().toLowerCase().replace(/[.:!*]+$/g, "").replace(/^\*+/, "");
  if (first === "correct") return "correct";
  if (first === "partly correct") return "partly";
  if (first === "not correct") return "not";
  return null;
}
```

`src/core/explain/sent.ts`: append exactly:

```ts
export const TASK_LABELS: Readonly<Record<string, string>> = {
  explain: "Explain",
  more_detail: "More detail",
  double_check: "Double-check",
  read_link: "Read a link",
  research: "Research the web",
  overview_script: "Audio overview",
  video_slides: "Video overview",
  diagram: "Diagram",
  mini_app: "Mini app",
  practice: "Practice set",
  retranscribe: "Second transcript",
};

// The fields of a sent body, in the order the "What was sent" screen shows them. Unknown fields are shown too, so the
// screen never hides anything that left the phone.
export function sentFields(sent: string): { label: string; text: string }[] {
  let body: unknown;
  try {
    body = JSON.parse(sent);
  } catch {
    return [{ label: "Sent", text: sent }];
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return [{ label: "Sent", text: sent }];
  const labels: Record<string, string> = { word: "Word", transcript: "Transcript", answer: "Explanation" };
  return Object.entries(body).map(([key, value]) => ({ label: labels[key] ?? key, text: typeof value === "string" ? value : JSON.stringify(value) }));
}
```

`src/platform/tasks.ts`: add `DoubleCheckResponse` and `FollowUpRequest` to the type import from `@waypoint/contracts`, and append exactly:

```ts
export function streamMoreDetail(request: FollowUpRequest, key: string, onDelta: (text: string) => void): Promise<StreamDone> {
  return api.moreDetail(request, { key, onDelta });
}

export function doubleCheck(request: FollowUpRequest, key: string): Promise<DoubleCheckResponse> {
  return api.doubleCheck(request, { key });
}
```

`src/features/explain/useExplain.ts` is replaced by exactly:

```ts
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest, FollowUpRequest } from "@waypoint/contracts";
import { listSegments } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround } from "../../core/explain/excerpt.ts";
import {
  addToThread,
  discardIfUnsaved,
  saveExplanation,
  shownAnswer,
  startExplanation,
  unsaveExplanation,
  type Explanation,
  type ThreadItem,
} from "../../core/explain/explanations.ts";
import { askLater } from "../../core/explain/later.ts";
import { logSent, settleSent, type SentTask } from "../../core/explain/sent.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { doubleCheck, streamExplain, streamMoreDetail, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

// What is running or went wrong right now. The answers so far are in explanation.thread.
export type ExplainPhase =
  | { kind: "idle" }
  | { kind: "running"; task: SentTask; text: string }
  | { kind: "failed"; task: SentTask; failure: CloudFailure; text: string };

// One tapped word: the excerpt around it, the thread of answers, and what is running. Each request gets an
// Idempotency-Key when the person taps; "Try again" re-uses it only when the request did not run (keepsKey).
export function useExplain(sessionId: string, t: number, word: string) {
  const [excerpt] = useState(() => excerptAround(listSegments(getDb(), sessionId), t));
  const [phase, setPhase] = useState<ExplainPhase>({ kind: "idle" });
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [askedLater, setAskedLater] = useState(false);
  const keys = useRef<Partial<Record<SentTask, string>>>({});
  const idRef = useRef<string | null>(null);

  // Closing the sheet keeps only saved explanations; sent_log keeps what was sent either way.
  useEffect(
    () => () => {
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    },
    [],
  );

  async function run(task: SentTask): Promise<void> {
    if (excerpt === "" || phase.kind === "running") return;
    const answer = explanation === null ? null : shownAnswer(explanation);
    if (task !== "explain" && answer === null) return;
    if (!requireApprovedDevice()) return;
    const key = keys.current[task] ?? randomUUID();
    keys.current[task] = key;
    const request: ExplainRequest | FollowUpRequest = task === "explain" ? { word, transcript: excerpt } : { word, transcript: excerpt, answer: answer ?? "" };
    writeDb((db) => logSent(db, { id: key, task, sessionId, body: request, at: Date.now() }));
    let text = "";
    setPhase({ kind: "running", task, text });
    const onDelta = (piece: string): void => {
      text += piece;
      setPhase({ kind: "running", task, text });
    };
    try {
      let credits: number;
      let retention: "standard" | "zero";
      if (task === "double_check") {
        const reply = await doubleCheck({ word, transcript: excerpt, answer: answer ?? "" }, key);
        ({ text, credits, retention } = reply);
      } else {
        const done = task === "explain" ? await streamExplain({ word, transcript: excerpt }, key, onDelta) : await streamMoreDetail({ word, transcript: excerpt, answer: answer ?? "" }, key, onDelta);
        ({ credits, retention } = done);
      }
      const item: ThreadItem = { kind: task, text, at: Date.now(), retention, sentId: key };
      const next = writeDb((db) => {
        settleSent(db, key, credits, retention);
        const id = idRef.current ?? startExplanation(db, deps, sessionId, t, word).id;
        idRef.current = id;
        return addToThread(db, id, item);
      });
      delete keys.current[task];
      setExplanation(next);
      setPhase({ kind: "idle" });
    } catch (error) {
      const failure = toFailure(error);
      if (!keepsKey(failure)) {
        writeDb((db) => settleSent(db, key, 0, null));
        delete keys.current[task];
      }
      setPhase({ kind: "failed", task, failure, text });
    }
  }

  function toggleSave(): void {
    const current = explanation;
    if (current === null) return;
    writeDb((db) => (current.saved ? unsaveExplanation(db, current.id) : saveExplanation(db, deps, current.id)));
    setExplanation({ ...current, saved: !current.saved });
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word));
    setAskedLater(true);
  }

  return { excerpt, phase, explanation, askedLater, run, toggleSave, saveForLater };
}
```

`src/features/explain/ExplainSheet.tsx` is replaced by exactly:

```tsx
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel, priceOf } from "../../core/config/config.ts";
import { verdictOf, type ThreadItem } from "../../core/explain/explanations.ts";
import type { SentTask } from "../../core/explain/sent.ts";
import { formatOffset } from "../../core/format.ts";
import { useConfig } from "../../platform/config.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors, type Colors } from "../../ui/theme.ts";
import { CloudLine } from "./CloudLine.tsx";
import { useExplain } from "./useExplain.ts";

// D1–D8: a tapped word, explained by the cloud, with more detail, a double-check and Save. A sheet over the recording or the session.
export default function ExplainSheet() {
  const params = useLocalSearchParams<{ sessionId: string; t: string; word: string }>();
  const t = Number(params.t);
  return <ExplainBody sessionId={params.sessionId} t={Number.isFinite(t) ? t : 0} word={params.word.slice(0, 100)} />;
}

const HEADINGS: Record<SentTask, string> = { explain: "Explanation", more_detail: "More detail", double_check: "Double-check" };
const RUNNING: Record<SentTask, string> = { explain: "Explaining…", more_detail: "Adding more detail…", double_check: "Double-checking…" };

function ExplainBody({ sessionId, t, word }: { sessionId: string; t: number; word: string }) {
  const colors = useColors();
  const config = useConfig();
  const model = useExplain(sessionId, t, word);
  const [showSent, setShowSent] = useState(false);
  const price = (key: SentTask, fallback: number): string => creditsLabel(priceOf(config, key) ?? fallback);
  const { phase, explanation } = model;
  const thread = explanation?.thread ?? [];
  const hasAnswer = thread.some((item) => item.kind === "explain");

  function act(action: FailureAction): void {
    if (phase.kind !== "failed") return;
    if (action === "try_again") void model.run(phase.task);
    else if (action === "get_credits" && phase.failure.kind === "out_of_credits") router.push(`/plans?need=${phase.failure.shortfall}`);
    else if (action === "ask_later") model.saveForLater();
    else if (action === "approve_device") router.push("/device-waiting");
    else router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Title>{word}</Title>
      <Caption>{`At ${formatOffset(t)} in this recording`}</Caption>

      {!hasAnswer && phase.kind !== "running" ? (
        model.excerpt === "" ? (
          <Body>There isn't enough of the transcript around this word yet.</Body>
        ) : (
          <>
            <Body style={{ color: colors.ink2 }}>Waypoint sends this word and about a minute of the transcript around it, for this task only.</Body>
            <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)}>
              <Text style={[styles.link, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
            </Pressable>
            {showSent ? <Text style={[styles.sent, { color: colors.ink3, backgroundColor: colors.surface2 }]}>{model.excerpt}</Text> : null}
            {phase.kind === "idle" ? <PrimaryButton label={`Explain · ${price("explain", 1)}`} icon="sparkle.magnifyingglass" onPress={() => void model.run("explain")} /> : null}
          </>
        )
      ) : null}

      {thread.map((item, index) => (
        <ThreadBlock key={`${item.sentId}-${index}`} item={item} colors={colors} />
      ))}

      {phase.kind === "running" ? (
        <View style={styles.block}>
          <Caption>{HEADINGS[phase.task]}</Caption>
          {phase.text === "" ? <ActivityIndicator /> : <Body>{phase.text}</Body>}
          <Caption>{RUNNING[phase.task]}</Caption>
        </View>
      ) : null}

      {phase.kind === "failed" ? (
        <View style={styles.block}>
          {phase.text !== "" ? <Body style={{ color: colors.ink3 }}>{phase.text}</Body> : null}
          <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
            <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{failureCopy(phase.failure).title}</Text>
            <Text style={[styles.boxBody, { color: colors.flagInk }]}>{failureCopy(phase.failure).body}</Text>
          </View>
          {model.askedLater ? <Caption>Saved as a question for later.</Caption> : null}
          {failureCopy(phase.failure).actions.map((action, index) =>
            action === "ask_later" && model.askedLater ? null : index === 0 ? (
              <PrimaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
            ) : (
              <SecondaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
            ),
          )}
        </View>
      ) : null}

      {hasAnswer && phase.kind !== "running" ? (
        <View style={styles.block}>
          <SecondaryButton label={`More detail · ${price("more_detail", 3)}`} icon="text.append" onPress={() => void model.run("more_detail")} />
          <SecondaryButton label={`Double-check · ${price("double_check", 4)}`} icon="checkmark.seal" onPress={() => void model.run("double_check")} />
          <SecondaryButton
            label={explanation?.saved === true ? "Saved" : "Save"}
            icon={explanation?.saved === true ? "bookmark.fill" : "bookmark"}
            tone={explanation?.saved === true ? "accent" : "surface"}
            onPress={model.toggleSave}
          />
          {explanation?.saved === true ? <Caption>Saved with this recording.</Caption> : null}
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ThreadBlock({ item, colors }: { item: ThreadItem; colors: Colors }) {
  const verdict = item.kind === "double_check" ? verdictOf(item.text) : null;
  const tint = verdict === "correct" ? colors.local : verdict === "partly" ? colors.flag : verdict === "not" ? colors.danger : null;
  return (
    <View style={styles.block}>
      <Caption>{HEADINGS[item.kind]}</Caption>
      <View style={tint === null ? undefined : [styles.verdict, { borderColor: tint }]}>
        <Body>{item.text}</Body>
      </View>
      <CloudLine retention={item.retention} onPress={() => router.push(`/sent?id=${encodeURIComponent(item.sentId)}`)} />
    </View>
  );
}

const ACTION_LABELS: Record<FailureAction, string> = {
  try_again: "Try again",
  get_credits: "Get credits",
  ask_later: "Ask later",
  approve_device: "Set up this iPhone",
  close: "Close",
};

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  block: { gap: 10 },
  link: { fontSize: 15, fontWeight: "600" },
  sent: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 12 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
  verdict: { borderLeftWidth: 4, paddingLeft: 12 },
});
```

`src/features/explain/SentScreen.tsx`, exactly:

```tsx
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { creditsLabel } from "../../core/config/config.ts";
import { shortDate } from "../../core/store/plans.ts";
import { TASK_LABELS, getSent, sentFields } from "../../core/explain/sent.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, OnDeviceNote, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { CloudLine } from "./CloudLine.tsx";

// "What was sent" for one cloud task: exactly the text that left the phone, from sent_log.
export default function SentScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = useQuery((db) => getSent(db, id));
  if (entry === null) {
    return (
      <Screen>
        <Title>What was sent</Title>
        <Caption>This record was deleted with its recording.</Caption>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }
  const charged = entry.credits === null ? "Waiting for the answer" : entry.credits === 0 ? "Not charged" : creditsLabel(entry.credits);
  return (
    <Screen>
      <Title>What was sent</Title>
      <Caption>{`${TASK_LABELS[entry.task] ?? entry.task} · ${shortDate(entry.at, -new Date().getTimezoneOffset())} · ${charged}`}</Caption>
      {entry.retention !== null ? <CloudLine retention={entry.retention} /> : null}
      {sentFields(entry.sent).map((field) => (
        <View key={field.label} style={styles.field}>
          <Caption>{field.label}</Caption>
          <Text selectable style={[styles.text, { color: colors.ink, backgroundColor: colors.surface2 }]}>
            {field.text}
          </Text>
        </View>
      ))}
      <OnDeviceNote text="This record is kept only on this iPhone." />
      <PrimaryButton label="Done" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  text: { fontSize: 15, lineHeight: 21, padding: 12, borderRadius: 12 },
});
```

`src/app/sent.tsx`: `export { default } from "../features/explain/SentScreen.tsx";`. `src/app/_layout.tsx`, inside the signed-in `Stack.Protected`: `<Stack.Screen name="sent" options={{ presentation: "modal" }} />`.

`test/explain-thread.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { addToThread, getExplanation, saveExplanation, shownAnswer, startExplanation, unsaveExplanation, verdictOf, type ThreadItem } from "../src/core/explain/explanations.ts";
import { TASK_LABELS, sentFields } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  return { db, deps };
}
const item = (kind: ThreadItem["kind"], text: string): ThreadItem => ({ kind, text, at: 1, retention: "standard", sentId: `k_${text}` });

describe("thread", () => {
  it("save adds one term with the first answer; unsave removes it", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "osmosis");
    expect(() => saveExplanation(db, deps, e.id)).toThrow("nothing to save yet");
    addToThread(db, e.id, item("explain", "first"));
    addToThread(db, e.id, item("more_detail", "more"));
    saveExplanation(db, deps, e.id);
    saveExplanation(db, deps, e.id);
    expect(getExplanation(db, e.id)?.saved).toBe(true);
    expect(db.all("SELECT term, meaning FROM terms")).toEqual([{ term: "osmosis", meaning: "first" }]);
    unsaveExplanation(db, e.id);
    expect(getExplanation(db, e.id)?.saved).toBe(false);
    expect(db.all("SELECT * FROM terms")).toEqual([]);
  });
  it("shownAnswer is the latest explain item", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    expect(shownAnswer(e)).toBeNull();
    addToThread(db, e.id, item("explain", "a"));
    addToThread(db, e.id, item("double_check", "Correct"));
    const after = addToThread(db, e.id, item("explain", "b"));
    expect(shownAnswer(after)).toBe("b");
  });
  it("verdictOf", () => {
    expect(verdictOf("Correct\nIt is right.")).toBe("correct");
    expect(verdictOf("Partly correct.\nBut…")).toBe("partly");
    expect(verdictOf("**Not correct**\n...")).toBe("not");
    expect(verdictOf("Maybe")).toBeNull();
    expect(verdictOf("")).toBeNull();
  });
});

describe("sent", () => {
  it("sentFields labels known fields and keeps unknown ones", () => {
    expect(sentFields(JSON.stringify({ word: "w", transcript: "t", answer: "a" }))).toEqual([
      { label: "Word", text: "w" },
      { label: "Transcript", text: "t" },
      { label: "Explanation", text: "a" },
    ]);
    expect(sentFields(JSON.stringify({ minutes: 4 }))).toEqual([{ label: "minutes", text: "4" }]);
    expect(sentFields("not json")).toEqual([{ label: "Sent", text: "not json" }]);
    expect(sentFields("[1]")).toEqual([{ label: "Sent", text: "[1]" }]);
  });
  it("every task has a label", () => {
    expect(Object.keys(TASK_LABELS)).toHaveLength(11);
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (as M15, with PR 15 on the server):
1. Explain a word, then "More detail · 3 credits": a second block streams under the first, with its own cloud line.
2. "Double-check · 4 credits": one block appears at once, starting "Correct" (or the other two) with a coloured edge.
3. Tap a cloud line: "What was sent" shows Word, Transcript and, for the follow-ups, Explanation, matching what the sheet showed; the cost matches `GET /v1/wallet/ledger`.
4. Save, then close: in a debug build the `explanations` row has `saved = 1` and a `terms` row exists. Explain another word without saving and close: its `explanations` row is gone, its `sent_log` row stays.
5. Make More detail fail before it answers (in a staging KV, point the standard tier at a model id that does not exist): "Couldn't get an answer", the wallet is not charged, "Try again" sends a new key.

Not in this PR: listing saved explanations in the session or the transcript (M33), flashcards from terms, editing an answer, sharing an answer, read-link and research (M19).

---

### M20 · Push: token to `POST /v1/push-tokens`, taps, "approved" notice

Branch `pr/m20-push`. After M27a (and the server's PR 31, merged). Dependencies: `expo-notifications` 58.1.8 (published 2026-11-03, 16 days before 2026-11-19; SDK 58 asks for `~58.1.8`; 58.1.9 is too new) and `expo-application` 58.1.2 (published 2026-10-16; SDK 58 asks for `~58.1.2`). Files, all under `apps/mobile/`: `package.json`, `app.json` (one plugin), `src/core/push/push.ts`, `src/platform/push.ts`, `src/app/(tabs)/_layout.tsx` (one hook call), `src/shell/DeviceWaitingScreen.tsx` (the edits below), `test/push.test.ts`. Plus `package-lock.json`.

Why it looks like this:
- The server pushes "Your result is ready." (`job_ready`), pairing notices (`device_request`, `device_approved`) and background `sync` (`apps/api/src/push/messages.ts`). Payloads carry only `kind` and `ref`, never note text.
- `POST /v1/push-tokens` takes `device_id` = this device's `devices.id` (registered by M27a; a waiting device registers too, because `device_approved` goes to the waiting device), the APNs device token as lowercase hex, and `sandbox` or `production`. The environment comes from the app's own provisioning profile (`getIosPushNotificationServiceEnvironmentAsync()` from `expo-application`: `development` → `sandbox`, `production` → `production`, `null` in the Simulator → do not register), so a development build never sends a sandbox token as production.
- The app **does not ask** for notification permission at launch. It asks when there is a reason: here, "Notify me when it's approved" on the waiting screen; later, before the first long job (M18, M19). Once allowed, the token is sent on every launch where it changed.
- A tap on `device_approved` checks the device again (M27a's `refreshDeviceNow()`); the other kinds get their screens with the cards that build them.
- The `expo-notifications` config plugin adds `aps-environment` (`development`) to the entitlements; Xcode changes it to `production` when the archive is exported for the App Store. Checked here: `npx expo prebuild --platform ios --clean --no-install` writes `aps-environment` next to `com.apple.developer.applesignin`. The owner turns on Push Notifications for the app id (stage 2 owner setup).

`apps/mobile/package.json`: add `"expo-application": "58.1.2"` and `"expo-notifications": "58.1.8"` to `dependencies`. `app.json`: append `"expo-notifications"` to `plugins`.

`src/core/push/push.ts`, exactly:

```ts
import { PushTokenRequestSchema, type PushTokenRequest } from "@waypoint/contracts";

// expo-application's getIosPushNotificationServiceEnvironmentAsync() → the server's environment name. null (the
// Simulator, or no aps-environment) means: do not register.
export function pushEnvironment(env: "development" | "production" | null): "sandbox" | "production" | null {
  return env === "development" ? "sandbox" : env === "production" ? "production" : null;
}

// The body of POST /v1/push-tokens, or null when anything does not fit the contract.
export function pushTokenRequest(deviceId: string, token: string, environment: "sandbox" | "production"): PushTokenRequest | null {
  const parsed = PushTokenRequestSchema.safeParse({ device_id: deviceId, token: token.toLowerCase(), environment });
  return parsed.success ? parsed.data : null;
}

// Kept in settings after a successful POST, so the same token is not sent on every launch.
export function pushSentValue(request: PushTokenRequest): string {
  return `${request.device_id}:${request.environment}:${request.token}`;
}
export const PUSH_SENT_KEY = "push_token_sent";

// What a tapped notification should do. Payloads carry only kind and ref (apps/api/src/push/messages.ts).
export type PushAction = { kind: "refresh_device" } | { kind: "none" };

export function actionForPush(data: Record<string, unknown>): PushAction {
  if (data.kind === "device_approved") return { kind: "refresh_device" };
  // job_ready opens the job's screen once M18/M19 exist; device_request opens approval in M27b; sync is M28.
  return { kind: "none" };
}
```

`src/platform/push.ts`, exactly (type-checked here against `expo-notifications` 58.1.8 and `expo-application` 58.1.2; `content.data` may be `undefined` in their types, hence `?? {}`):

```ts
import { useEffect } from "react";
import { getIosPushNotificationServiceEnvironmentAsync } from "expo-application";
import * as Notifications from "expo-notifications";
import { PUSH_SENT_KEY, actionForPush, pushEnvironment, pushSentValue, pushTokenRequest } from "../core/push/push.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { getDeviceKeys } from "../../modules/waypoint-keys/index.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { currentUserId, refreshDeviceNow, useDeviceStatus } from "./device.ts";

// Alerts show as banners while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Sends this iPhone's APNs token for its devices.id when notifications are allowed. Never asks; never throws.
export async function registerPushToken(): Promise<void> {
  try {
    const userId = currentUserId();
    const keys = userId === null ? null : getDeviceKeys(userId);
    if (keys === null) return;
    if ((await Notifications.getPermissionsAsync()).status !== "granted") return;
    const environment = pushEnvironment(await getIosPushNotificationServiceEnvironmentAsync());
    if (environment === null) return;
    const token = await Notifications.getDevicePushTokenAsync();
    const request = pushTokenRequest(keys.deviceId, String(token.data), environment);
    if (request === null || getSetting(getDb(), PUSH_SENT_KEY) === pushSentValue(request)) return;
    await api.pushToken(request);
    writeDb((db) => setSetting(db, PUSH_SENT_KEY, pushSentValue(request)));
  } catch {
    // Tried again on the next launch.
  }
}

// Asks once (iOS shows its prompt only the first time), then registers. Returns whether notifications are allowed.
export async function askForPush(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (status === "granted") await registerPushToken();
  return status === "granted";
}

function handle(response: Notifications.NotificationResponse | null): void {
  if (response === null) return;
  const action = actionForPush(response.notification.request.content.data ?? {});
  if (action.kind === "refresh_device") void refreshDeviceNow();
}

// Called once in (tabs)/_layout.tsx: registers the token once this iPhone has a device row, and handles taps.
export function usePush(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status === "approved" || status === "waiting") void registerPushToken();
  }, [status]);
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
```

`src/app/(tabs)/_layout.tsx`: call `usePush()` next to the other hooks.

`src/shell/DeviceWaitingScreen.tsx` (from M27a): import `askForPush` from `../platform/push.ts`; add `const [notify, setNotify] = useState<"ask" | "on" | "off">("ask");`; and before the "Close" button add:

```tsx
        {status === "waiting" && notify === "ask" ? (
          <SecondaryButton label="Notify me when it's approved" icon="bell" onPress={() => void askForPush().then((ok) => setNotify(ok ? "on" : "off"))} />
        ) : null}
        {status === "waiting" && notify === "on" ? <Caption>We'll let you know.</Caption> : null}
        {status === "waiting" && notify === "off" ? <Caption>Notifications are off. Turn them on in Settings to hear when it's approved.</Caption> : null}
```

`test/push.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { actionForPush, pushEnvironment, pushSentValue, pushTokenRequest } from "../src/core/push/push.ts";

const TOKEN = "AB".repeat(32);

describe("push", () => {
  it("environment names", () => {
    expect(pushEnvironment("development")).toBe("sandbox");
    expect(pushEnvironment("production")).toBe("production");
    expect(pushEnvironment(null)).toBeNull();
  });
  it("the request lower-cases the token and checks the contract", () => {
    const request = pushTokenRequest("3f2c6a1e-0000-4000-8000-000000000001", TOKEN, "sandbox");
    expect(request).toEqual({ device_id: "3f2c6a1e-0000-4000-8000-000000000001", token: "ab".repeat(32), environment: "sandbox" });
    expect(pushTokenRequest("short", TOKEN, "sandbox")).toBeNull();
    expect(pushTokenRequest("3f2c6a1e-0000-4000-8000-000000000001", "xyz", "sandbox")).toBeNull();
    if (request === null) throw new Error("expected a request");
    expect(pushSentValue(request)).toBe(`3f2c6a1e-0000-4000-8000-000000000001:sandbox:${"ab".repeat(32)}`);
  });
  it("taps", () => {
    expect(actionForPush({ kind: "device_approved", ref: "dev" })).toEqual({ kind: "refresh_device" });
    expect(actionForPush({ kind: "job_ready", ref: "job_1" })).toEqual({ kind: "none" });
    expect(actionForPush({})).toEqual({ kind: "none" });
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`; `npm run prebuild -w @waypoint/mobile`, then `apps/mobile/ios/Waypoint/Waypoint.entitlements` contains `aps-environment` and `git status` shows no `ios/`.

Device check (needs Xcode, Push Notifications on the app id, the APNs key in the Worker (PR 31)):
1. Launch: no permission prompt.
2. On a waiting iPhone, "Notify me when it's approved" shows the system prompt; allow. `push_tokens` gets one row for this device with `environment = 'sandbox'`. Relaunch: no second POST (the token did not change).
3. Send `{ user_id, kind: "device_approved", ref: <device id>, device_id: <device id> }` to `waypoint-push` (`wrangler queues` or a test route) with the app in the background: the banner "Your new device was approved." shows; tapping it opens the app and runs the device check.
4. With the app open, a push shows as a banner.
5. In Settings › Notifications › Waypoint turn notifications off: nothing breaks; the waiting screen says how to turn them back on.

Not in this PR: `job_ready` screens (M18, M19), `device_request` (M27b), background `sync` and the `remote-notification` background mode (M28), a Notifications row in Settings › Permissions (M21 or later), badges, notification sounds of our own.

---

### M21 · Settings: cloud activity and zero retention (Plus only)

Branch `pr/m21-cloud-privacy`. After M12 (the settings feature) and M16 (`sent_log`, `TASK_LABELS`, `/sent`), and the server's PR 32 (merged). No new dependencies. Files, all under `apps/mobile/`: `src/core/cloud/activity.ts`, `src/platform/privacy.ts`, `src/features/settings/CloudScreen.tsx`, `src/app/settings-cloud.tsx`, `src/app/_layout.tsx` (one screen), `src/features/settings/SettingsScreen.tsx` (one row), `test/activity.test.ts`.

Why it looks like this (J5, K2's Plus switch; `docs/build-plan.md` decision 8 and open question 1):
- **Zero retention** (`PUT /v1/settings/zero-retention`) is for Plus only; the server answers 403 `plan_required` otherwise. With it on, cloud tasks may use only zero-retention routes, and **no route is zero-retention yet**, so every cloud task then fails with 403 (`docs/architecture.md` sections 4 and 6). The switch is shown, as decided, with that said plainly beside it and again in a confirmation before it turns on. Hiding it instead is one constant (`SHOW_ZERO_RETENTION` below) if the owner decides so.
- The server has no route that reads the switch. The app keeps what it last set in `settings` and shows the switch on only while the plan is Plus (the server turns it off when Plus ends). See "Questions".
- **Cloud activity** (`GET /v1/activity`): the server keeps task, size, credits, route and time, never the text (`docs/architecture.md` section 4). The app lists it newest first, 50 at a time. When the item's Idempotency-Key (the end of its id) matches a `sent_log` row on this phone, the row opens "What was sent" (M16); otherwise it says the text is not on this iPhone (sent from another device, or its recording was deleted).

`src/core/cloud/activity.ts`, exactly:

```ts
import type { ActivityItem } from "@waypoint/contracts";
import { creditsLabel } from "../config/config.ts";
import { TASK_LABELS } from "../explain/sent.ts";
import { shortDate } from "../store/plans.ts";

// The server's activity id is the hold id, "<task>:<user id>:<Idempotency-Key>" (apps/api/src/tasks/instant.ts); the
// key is also this phone's sent_log id. null when the id has no key part.
export function sentKeyOf(activityId: string): string | null {
  const key = activityId.slice(activityId.lastIndexOf(":") + 1);
  return activityId.includes(":") && /^[A-Za-z0-9_-]{16,64}$/.test(key) ? key : null;
}

// "<1 KB", "3 KB", "1.2 MB" (1,000-based).
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return "<1 KB";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export type ActivityLine = { title: string; detail: string; retention: "standard" | "zero" };

export function activityLine(item: ActivityItem, offsetMinutes: number): ActivityLine {
  const cost = item.credits === 0 ? "Not charged" : creditsLabel(item.credits);
  return {
    title: TASK_LABELS[item.task] ?? item.task,
    detail: `${shortDate(item.at, offsetMinutes)} · ${cost} · ${sizeLabel(item.bytes_sent)} sent`,
    retention: item.retention,
  };
}

// The switch's state as this phone last set it. The server has no read route for it (open question), and turns it off
// itself when Plus ends, so the screen shows it on only for Plus.
export const ZERO_RETENTION_KEY = "zero_retention";

export function zeroRetentionShown(stored: string | null, plan: "free" | "plus" | "own" | null): boolean {
  return plan === "plus" && stored === "1";
}
```

`src/platform/privacy.ts`, exactly:

```ts
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { ActivityItem } from "@waypoint/contracts";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import { ZERO_RETENTION_KEY } from "../core/cloud/activity.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { api } from "./api.ts";
import { useQuery, writeDb } from "./db.ts";

export type SwitchResult = "ok" | "plan_required" | "offline" | "failed";

// PUT /v1/settings/zero-retention (PR 32). Plus only; the server answers 403 plan_required otherwise.
export async function setZeroRetention(enabled: boolean): Promise<SwitchResult> {
  try {
    const reply = await api.setZeroRetention(enabled);
    writeDb((db) => setSetting(db, ZERO_RETENTION_KEY, reply.zero_retention ? "1" : "0"));
    return "ok";
  } catch (error) {
    if (error instanceof ApiCallError && error.code === "plan_required") return "plan_required";
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

export function useStoredZeroRetention(): string | null {
  return useQuery((db) => getSetting(db, ZERO_RETENTION_KEY));
}

export type ActivityState = { items: ActivityItem[]; more: boolean; error: "offline" | "failed" | null; loadMore: () => void };

// GET /v1/activity, newest first, 50 at a time; reloaded each time the screen comes into view.
export function useActivity(): ActivityState {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<"offline" | "failed" | null>(null);
  const load = useCallback((before: string | null) => {
    api.activity(before ?? undefined).then(
      (page) => {
        setItems((old) => (before === null ? page.items : [...old, ...page.items]));
        setNext(page.next);
        setError(null);
      },
      (e: unknown) => setError(e instanceof NetworkError ? "offline" : "failed"),
    );
  }, []);
  useFocusEffect(useCallback(() => load(null), [load]));
  return { items, more: next !== null, error, loadMore: () => (next === null ? undefined : load(next)) };
}
```

`src/features/settings/CloudScreen.tsx` (`/settings-cloud`). Copy written for this card; check it against J5 and K2. Pieces from `src/ui/kit.tsx`; `useWallet()` (M17) for the plan; `useStoredZeroRetention()`, `setZeroRetention()` and `useActivity()` from `src/platform/privacy.ts`; `getSent` (M16) through `useQuery` to know which keys have a local record.
- `const SHOW_ZERO_RETENTION = true;` at the top of the file.
- Back button and `Title` "Cloud & privacy".
- Body: "Recording, pages, flashcards, quizzes and search never leave this iPhone. Only the cloud tasks you tap send text, and only for that task."
- Section caption "ZERO RETENTION" (only when `SHOW_ZERO_RETENTION`): a row with the title "Zero retention", a React Native `Switch` with `value = zeroRetentionShown(stored, wallet?.plan ?? null)`.
  - Plan not Plus: the switch is disabled; caption "Plus only." and a text button "See Plus" → `/plans`.
  - Off (Plus): caption "Cloud tasks use open models that keep your text only while they answer."
  - On: a `flagSoft` box: "Zero retention is on. No model that keeps nothing is available yet, so Explain and other cloud tasks won't work until one is. Everything on this iPhone keeps working."
  - Turning it on first asks with `Alert.alert("Turn on zero retention?", "Cloud tasks will use only models that keep nothing. None is available yet, so Explain and every other cloud task will stop working until one is.", [{ text: "Cancel", style: "cancel" }, { text: "Turn on", onPress: … }])`. Turning it off needs no confirmation.
  - Results of `setZeroRetention`: `plan_required` → "Zero retention needs Plus."; `offline` → "You're offline. Try again when you're connected."; `failed` → "Couldn't change it. Try again."; shown as a caption under the switch.
- Section caption "CLOUD ACTIVITY": one row per item with `activityLine(item, -new Date().getTimezoneOffset())`: title, `detail` as the subtitle, and under it the M16 `CloudLine` for `retention` (not pressable). When `sentKeyOf(item.id)` has a `sent_log` row, the row's right side shows "See what was sent" (`accent`) and pressing it opens `/sent?id=<key>`; otherwise a caption "What was sent isn't on this iPhone." and pressing does nothing. Empty list: "No cloud tasks yet." `error`: "Can't load activity offline." or "Couldn't load activity." A "Show more" text button while `more`.
- Footer `OnDeviceNote`: "The text you send is kept only on this iPhone. Waypoint's server keeps the task, its size, the credits and the time."

`src/app/settings-cloud.tsx` only re-exports the screen. `src/app/_layout.tsx`: inside the signed-in `Stack.Protected`, `<Stack.Screen name="settings-cloud" />`. `src/features/settings/SettingsScreen.tsx`: add a row "Cloud & privacy" (symbol `cloud`) after "Plans & credits" (M17) in the "ACCOUNT" section, opening `/settings-cloud`. Change nothing else there.

`test/activity.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { activityLine, sentKeyOf, sizeLabel, zeroRetentionShown } from "../src/core/cloud/activity.ts";

describe("activity", () => {
  it("sentKeyOf takes the Idempotency-Key from the hold id", () => {
    expect(sentKeyOf("explain:0b7c3c1e-1111-4111-8111-111111111111:9f1d2c3b-2222-4222-8222-222222222222")).toBe("9f1d2c3b-2222-4222-8222-222222222222");
    expect(sentKeyOf("explain:u1:short")).toBeNull();
    expect(sentKeyOf("no-colon-at-all-1234567890")).toBeNull();
  });
  it("sizeLabel", () => {
    expect(sizeLabel(0)).toBe("<1 KB");
    expect(sizeLabel(999)).toBe("<1 KB");
    expect(sizeLabel(1_499)).toBe("1 KB");
    expect(sizeLabel(1_250_000)).toBe("1.3 MB");
  });
  it("activityLine", () => {
    const item = { id: "a", task: "more_detail" as const, bytes_sent: 2_400, credits: 3, route: "standard", retention: "zero" as const, at: Date.UTC(2026, 10, 19, 15) };
    expect(activityLine(item, 0)).toEqual({ title: "More detail", detail: "Nov 19 · 3 credits · 2 KB sent", retention: "zero" });
    expect(activityLine({ ...item, credits: 0 }, 0).detail).toContain("Not charged");
  });
  it("zeroRetentionShown only for Plus with the switch on", () => {
    expect(zeroRetentionShown("1", "plus")).toBe(true);
    expect(zeroRetentionShown("1", "own")).toBe(false);
    expect(zeroRetentionShown("0", "plus")).toBe(false);
    expect(zeroRetentionShown(null, null)).toBe(false);
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (needs Xcode and the API with PR 32 and PR 33's usage consumer, which writes `activity`):
1. After explaining two words (M15), Settings › Cloud & privacy lists two "Explain" rows with "1 credit" and their size; "See what was sent" opens the exact text.
2. On a free account the switch is disabled with "Plus only."; "See Plus" opens Plans.
3. On Plus: turning it on asks first; after "Turn on", the warning box shows; explaining a word now gives "Zero retention is on" (M15's 403 copy) and charges nothing. Turn it off: Explain works again.
4. Sign in on another phone with the same account: the same activity rows show with "What was sent isn't on this iPhone."

Not in this PR: deleting activity, exporting it, a per-space zero-retention override, reading level or AI mode settings, the Notifications permission row.

---

## 4. Outline: the rest of stage 2, and stages 3 and 4

One paragraph each. Full cards are written when their server cards are merged, against the code that exists then. Everything above (the API client, signing, `requireApprovedDevice()`, `sent_log`, the failure copy, `CloudLine`, the `/plans` and `/sent` routes, the keys module) is reused, not rebuilt.

### Stage 2, after the jobs API (PR 20, 23, 24)

**M18 · Second transcript (flow 3).** After PR 20 and PR 23. From a saved recording's menu, an opt-in sheet that says, before anything else, that **the audio leaves the phone** for this one job and is deleted when it ends (`docs/architecture.md` flow 3); per session or "always" in Settings, off by default. Quote first (`POST /v1/tasks/quote` with `task: "retranscribe"` and the minutes; 1 credit per minute) and show it on the button; this card also adds the small "Before you run it" quote box that M19 and stage 3 reuse (a component in the feature, not a route). `POST /v1/jobs` (signed; the job records this device), upload each audio part to the signed URL PR 23 returns, follow `GET /v1/jobs/:id/events`, then fetch `GET /v1/jobs/:id/result` (octet-stream), open it with M26b's `openSealedResult` (sealed to this iPhone's Secure Enclave key, `docs/security.md` section 14), store the words as `segments` with `source = 'cloud'`, show which words changed (a word diff in `src/core`), and `DELETE /v1/jobs/:id`. `sent_log` records the job with the audio size. Adds `job_ready` → the job's screen to M20's `actionForPush`, and asks for notifications (M20's `askForPush`) before the first job.

**M19 · Research the web (D10–D12).** After PR 20 and PR 24. Started from Explain when the answer's `offer_research` is true, or from a session. Depth quick, standard or deep (15, 45, 125 credits) with the quote box; `POST /v1/jobs` type `research`; progress from the events stream; the sealed result (answer and sources) opened on the device and saved locally with the session; sources open in the in-app browser. "Read a link" (PR 26) joins it once its price is decided (open question 5).

**M33 · Questions for later (was M17 in `docs/cards/mobile.md`).** Flags and the "Ask later" questions from M15 get answers when the phone is online again: a "Questions for later" row on Home (B1) and a list (D9, R5) where each open question can be explained with one tap (M15's sheet, same rules and prices), dismissed, or marked answered. Saved explanations (M16) show on the session's transcript at their time. No new tables.

### Stage 3: overviews and voices (after PR 22 and PR 25)

**M22 · On-device voices (`modules/waypoint-voices`).** Kokoro-82M as a Core ML model, run on the Neural Engine, downloaded on first use from the voice pack in `GET /v1/config` (`voice_pack`: url, sha256, size, version; M13 already caches it), checked by SHA-256 with CryptoKit before it is compiled (`MLModel.compileModel(at:)`) and kept in Application Support, excluded from backup. Until it is ready, `AVSpeechSynthesizer` system voices. Phones too old for it use the MeloTTS cloud fallback for +2 credits (`fallback_voice` in the quote). **Start with a spike:** Kokoro takes phonemes, not text, so it needs an English grapheme-to-phoneme step on the device (its usual tools are Python and espeak-ng); find or build a Swift G2P that matches the model's training before writing the card, and measure speed and memory on the oldest supported iPhone.

**M23 · Audio overview (G7, R1–R3).** Quote (`overview_script`, 40 credits, minutes of transcript), `POST /v1/jobs`, the sealed two-host script opened on the device, rendered with two voices (M22) into one audio file with `AVAudioEngine`, saved locally, then `DELETE /v1/jobs/:id`. Adds the `overviews` table (`docs/architecture.md` section 5) as the next device migration, and a player.

**M24 · Video overview (G10).** `video_slides` (50 credits): the sealed slide list from the job; narration with M22; slides drawn on the device and assembled with `AVAssetWriter`. No cloud renderer. Probably two sittings (rendering, then assembly and the player).

**M25 · Diagram, mini app and practice set (G8, G9).** Three job types on the same job screens. A mini app is generated HTML: it runs only in a sandboxed web view with no network access and nothing from the app's storage; decide the web view package (or a small native module) in the card.

### Stage 4: more devices, recovery, sync, sharing, over the air, system surfaces

**M27b · Devices and the recovery key (A4–A6, J1–J3).** After S1C, S1D, S2, S3 and S1F. Settings › Devices lists `GET /v1/devices`. **Approve**: on a `device_request` push, the approving phone fetches the pairing, sends its nonce (signed), checks the new device's commitment itself, shows the 6-digit code (M26a's `Pairing.code`), and on "They match" posts the certificate (account key), the account-key envelope and the group envelopes. **New device side**: polls for the approver's nonce, reveals its own (never before), shows the code, then opens and verifies the account envelope (signer's certificate checked against the account key). **Remove** a device (S1D: new account key, new certificates and envelopes, key versions bumped). **Recovery key**: 16 random bytes as 12 BIP-39 words (the word list checked by SHA-256 and the Trezor vectors in `swift test`), "type 3 words back", `PUT /v1/recovery`; recovering without another device unwraps the account key from `GET /v1/recovery` and approves itself signed by the account key (`Waypoint-Device` = the account row id), which needs one more native function. Two or three sittings.

**M28 · Sync.** After PR 27 and PR 28 (and PR 29 for media). The `outbox` table; group keys made and wrapped per `docs/security.md` section 10 (first set wins, a random 0–30 s delay, refetch on 409); every change, snapshot and file locked with M26a's `LockedContent` and its context; the group socket with catch-up by sequence number; media uploads on paid plans; background `sync` pushes (adds the `remote-notification` background mode); the trust-on-first-use list of co-members' account keys and the "security key changed" notice. Three sittings at least.

**M29 · Share bundle (I1–I9, E9).** Groups, invites, members leaving and access ending, shared links with their key only in the URL fragment (`#k=`) and an optional passcode (PR 30), moving a note into a group, key history. After M28.

**M2 · Over-the-air bundles with Zephyr.** One Module Federation remote per `src/features/*` folder (capture, study, search, settings, explain, plans, share) plus `src/shell`, built with `zephyr-metro-plugin`, one Zephyr tag per native version (`ios-<expo.version>`), cached by `zephyr-native-cache`, applied on the next cold start and never during a recording. Native modules (crypto above all) ship only in store builds. Starts with a spike: `@module-federation/metro` 2.9.3 declares Metro `^0.82` while SDK 58 ships 0.87, and expo-router with remotes is not documented.

**M30 · System targets.** Home Screen widgets (B5), a Live Activity and Dynamic Island while recording (C10), and the share extension (E8), with shared state in an App Group, through `expo-widgets` 58 or a config plugin that adds the Swift targets. The share extension only hands content to the app; it never holds or uses keys.

**M31 · sqlite-vec** once expo/expo#43455 ships the iOS framework, replacing the TypeScript vector scan with the same `search_index` data. **M32 · Component tests** with `jest-expo` if screens grow logic that `src/core` cannot hold.

---

## 5. Questions and decisions for the owner

1. **S1G is a server change.** Without it the app cannot learn its own user id, so it cannot certify its first device or set `appAccountToken`. It is three lines and is written above; please accept it into the server track and add it to "Build order" (batch 6). Alternative: a `GET /v1/me` route, which is more surface for the same thing.
2. **A lost or replaced first iPhone in stage 2.** Until M27b, there is no way to approve a second device and no recovery key. Someone who loses their only approved iPhone (or whose Keychain is wiped) can sign in on a new one, but it stays "waiting" for ever, so their purchased credits cannot be spent. Options: (a) bring M27b's recovery-key part forward, right after M27a and before real purchases; (b) a server "reset the account key" route allowed only while the user has no groups (nothing is locked yet); it would need the security reviewer's agreement, because a stolen session could use it. Recommendation: (a), before TestFlight with real money.
3. **Explain sends only after a tap on "Explain · 1 credit"** (M15), not on the word tap itself. This protects pocket money and makes sending a choice. If the boards show an instant answer on tap, say so and M15 changes one screen state.
4. **"Update Waypoint" can be closed** (M13); only cloud actions open it again. A hard block of the whole app is one line, but would lock students out of their own notes.
5. **The zero-retention switch has no read route.** The app shows what it last set. If the switch was changed on another device the screen can be wrong until it is set again. A `zero_retention` field in `GET /v1/wallet` (a server card) would fix it. Also open question 1 in `docs/build-plan.md` (show or hide the switch until a zero-retention route exists): the cards show it, with the warning, behind `SHOW_ZERO_RETENTION`.
6. **Keys per person on a shared device.** The Keychain keeps a separate key set per Waypoint user, so two family members on one iPad each get their own device row. Their notes are still in one SQLite file on that iPad (stage 1 has no per-user database); that is `docs/security.md` R14 and open question 20.
7. **Kokoro on the phone needs a phonemizer** (M22). It is the biggest unknown left in the app; a spike should come before stage 3 is planned in detail.
8. **Screen copy.** The design boards could not be opened while writing these cards. The copy in M13, M17, M15, M16, M21 and the waiting screen follows the architecture's wording but should be checked against D1–D8, O1–O14, J5 and K2.
9. **Numbering.** Plans is M17 and Explain is M15–M16 here (the outline in `docs/cards/mobile.md` had Plans as M15); "Questions for later" is now M33. `docs/build-plan.md`'s mobile table should be updated to match when convenient.
10. **Sandbox purchases on production** (open question 8 in `docs/build-plan.md`) decide whether M14's device check runs against production or a staging Worker.
