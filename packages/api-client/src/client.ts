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
