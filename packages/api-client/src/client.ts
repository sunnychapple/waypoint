import {
  ActivityResponseSchema,
  ApiErrorSchema,
  ApplePurchaseResponseSchema,
  ApproveDeviceRequestSchema,
  AUDIO_CHUNK_CONTENT_TYPE,
  AudioChunkResponseSchema,
  AudioDoneResponseSchema,
  BlobStoredSchema,
  ChangesPageSchema,
  ConfigResponseSchema,
  CreateGroupRequestSchema,
  CreateInviteRequestSchema,
  CreateLinkRequestSchema,
  DeviceListSchema,
  DeviceViewSchema,
  DoubleCheckResponseSchema,
  GroupDevicesSchema,
  GroupKeysRequestSchema,
  GroupKeysResponseSchema,
  GroupListSchema,
  GroupViewSchema,
  IDEMPOTENCY_KEY_HEADER,
  InviteViewSchema,
  JobResponseSchema,
  JobViewSchema,
  KeyIdSchema,
  LinkRevokedSchema,
  LinkViewSchema,
  MembershipEndedSchema,
  MyGroupKeysSchema,
  PairingViewSchema,
  PostChangeRequestSchema,
  PostChangeResponseSchema,
  PushTokenResponseSchema,
  PutRecoveryRequestSchema,
  QuoteResponseSchema,
  RecoveryViewSchema,
  RemoveDeviceRequestSchema,
  RemoveDeviceResponseSchema,
  StreamDeltaSchema,
  StreamDoneSchema,
  WalletResponseSchema,
  ZeroRetentionResponseSchema,
  type ActivityResponse,
  type ApplePurchaseResponse,
  type AudioChunkResponse,
  type AudioDoneResponse,
  type ConfigResponse,
  type CreateJobRequest,
  type DeviceView,
  type DoubleCheckResponse,
  type ExplainRequest,
  type FollowUpRequest,
  type GroupView,
  type JobView,
  type PairingView,
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

export type FetchInit = { method: string; headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; signal?: AbortSignal };
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

// "device": this device once approved. register: POST /v1/devices, signed as "new". as: a given signer under its own
// id (a device still waiting, for its pairing reveal; the account key, for approving itself during recovery).
type Signing = "none" | "device" | { register: DeviceSigner } | { as: DeviceSigner };

type CallSpec = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  target: string; // path and query, starting with "/v1/"
  body?: unknown; // sent as JSON
  raw?: { bytes: Uint8Array<ArrayBuffer>; contentType: string }; // sent as is; never signed (only session routes take raw bodies)
  key?: string; // Idempotency-Key; writes get a new one when absent
  token?: boolean; // default true; false only for GET /v1/config
  signing?: Signing;
  retry: boolean; // false for paid tasks: Try again must be the person's choice
  signal?: AbortSignal;
  accept?: string;
};

const RegisteredSchema = z.strictObject({ device: DeviceViewSchema });
// PUT /v1/recovery's reply (S3 has no contract for it).
const RecoverySavedSchema = z.strictObject({ account_device_id: KeyIdSchema, verified_at: z.number().int().nullable() });
export type RecoverySaved = z.infer<typeof RecoverySavedSchema>;
export type ApproveDeviceRequest = z.infer<typeof ApproveDeviceRequestSchema>;
export type RemoveDeviceRequest = z.infer<typeof RemoveDeviceRequestSchema>;
export type RemoveDeviceResponse = z.infer<typeof RemoveDeviceResponseSchema>;
export type PutRecoveryRequest = z.infer<typeof PutRecoveryRequestSchema>;
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;
export type InviteView = z.infer<typeof InviteViewSchema>;
export type MembershipEnded = z.infer<typeof MembershipEndedSchema>;
export type GroupDevices = z.infer<typeof GroupDevicesSchema>;
export type MyGroupKeys = z.infer<typeof MyGroupKeysSchema>;
export type GroupKeysRequest = z.infer<typeof GroupKeysRequestSchema>;
export type GroupKeysResponse = z.infer<typeof GroupKeysResponseSchema>;
export type ChangesPage = z.infer<typeof ChangesPageSchema>;
export type PostChangeRequest = z.infer<typeof PostChangeRequestSchema>;
export type BlobStored = z.infer<typeof BlobStoredSchema>;
export type CreateLinkRequest = z.infer<typeof CreateLinkRequestSchema>;
export type LinkView = z.infer<typeof LinkViewSchema>;
export type LinkRevoked = z.infer<typeof LinkRevokedSchema>;

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
    if (spec.raw !== undefined) headers["Content-Type"] = spec.raw.contentType;
    if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
    if (spec.token !== false) {
      const token = await options.getToken();
      if (token === null) throw new ApiCallError(401, "unauthorized", "sign in required", null);
      headers.Authorization = `Bearer ${token}`;
    }
    let signedOffset: number | null = null;
    const signing = spec.signing ?? "none";
    if (signing !== "none") {
      if (spec.raw !== undefined) throw new Error("raw bodies are never signed");
      const signer = signing === "device" ? options.device() : "register" in signing ? signing.register : signing.as;
      if (signer === null) throw new NotRegisteredError();
      const deviceId = signing === "device" || "as" in signing ? signer.id : "new";
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
    if (spec.raw !== undefined) init.body = spec.raw.bytes;
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

  // A reply that is bytes (a sealed job result, a locked file). A body cut off part way is a NetworkError.
  async function bytes(spec: CallSpec): Promise<Uint8Array<ArrayBuffer>> {
    const reply = await send(spec);
    try {
      return new Uint8Array(await reply.arrayBuffer());
    } catch {
      throw new NetworkError("reply ended early");
    }
  }

  // GET /v1/jobs/:id/events: one "state" event per change (PR 21). Resolves when the server ends the stream (the job
  // finished, or the stream reached its 10-minute limit); the caller opens a new one if the job is still running.
  async function jobEvents(id: string, onState: (job: JobView) => void, signal?: AbortSignal): Promise<void> {
    const spec: CallSpec = { method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}/events`, retry: false, accept: "text/event-stream" };
    if (signal !== undefined) spec.signal = signal;
    const reply = await send(spec);
    if (reply.body === null) throw new NetworkError("stream ended early");
    let bad = false;
    try {
      await readSse(reply.body, ({ event, data }) => {
        if (event !== "state") return true;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          bad = true;
          return false;
        }
        const job = JobViewSchema.safeParse(value);
        if (!job.success) {
          bad = true;
          return false;
        }
        onState(job.data);
        return true;
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      throw new NetworkError("stream ended early");
    }
    if (bad) throw new BadReplyError();
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
    // Devices and recovery (M27b; docs/security.md sections 8, 12 and 13).
    pairing: (deviceId: string): Promise<PairingView> =>
      json({ method: "GET", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing`, retry: true }, PairingViewSchema),
    sendPairingNonce: (deviceId: string, nonce: string): Promise<PairingView> =>
      json({ method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing`, body: { nonce }, signing: "device", retry: true }, PairingViewSchema),
    revealPairing: (deviceId: string, nonce: string, signer: DeviceSigner): Promise<PairingView> =>
      json(
        { method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing/reveal`, body: { nonce }, signing: { as: signer }, retry: true },
        PairingViewSchema,
      ),
    approveDevice: async (deviceId: string, request: ApproveDeviceRequest, signer?: DeviceSigner): Promise<DeviceView> =>
      (
        await json(
          { method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/approve`, body: request, signing: signer === undefined ? "device" : { as: signer }, retry: true },
          RegisteredSchema,
        )
      ).device,
    removeDevice: (deviceId: string, request: RemoveDeviceRequest): Promise<RemoveDeviceResponse> =>
      json({ method: "DELETE", target: `/v1/devices/${encodeURIComponent(deviceId)}`, body: request, signing: "device", retry: true }, RemoveDeviceResponseSchema),
    recovery: (): Promise<RecoveryView> => json({ method: "GET", target: "/v1/recovery", retry: true }, RecoveryViewSchema),
    putRecovery: (request: PutRecoveryRequest): Promise<RecoverySaved> =>
      json({ method: "PUT", target: "/v1/recovery", body: request, signing: "device", retry: true }, RecoverySavedSchema),
    // Jobs (PR 20, 21, 23). key: one per thing the person asked for, kept for "Try again" after Out of credits.
    createJob: async (request: CreateJobRequest, key: string): Promise<JobView> =>
      (await json({ method: "POST", target: "/v1/jobs", body: request, key, signing: "device", retry: true }, JobResponseSchema)).job,
    job: async (id: string): Promise<JobView> => (await json({ method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}`, retry: true }, JobResponseSchema)).job,
    jobEvents,
    jobResult: (id: string): Promise<Uint8Array<ArrayBuffer>> =>
      bytes({ method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}/result`, signing: "device", retry: true, accept: "application/octet-stream" }),
    deleteJob: async (id: string): Promise<JobView> =>
      (await json({ method: "DELETE", target: `/v1/jobs/${encodeURIComponent(id)}`, signing: "device", retry: true }, JobResponseSchema)).job,
    uploadAudio: (id: string, n: number, audio: Uint8Array<ArrayBuffer>): Promise<AudioChunkResponse> =>
      json(
        { method: "PUT", target: `/v1/jobs/${encodeURIComponent(id)}/audio/${n}`, raw: { bytes: audio, contentType: AUDIO_CHUNK_CONTENT_TYPE }, retry: true },
        AudioChunkResponseSchema,
      ),
    // key: pass the same one on a repeat, so a "done" the server already took is replayed, not refused (409).
    audioDone: (id: string, chunks: number, key?: string): Promise<AudioDoneResponse> =>
      json(
        { method: "POST", target: `/v1/jobs/${encodeURIComponent(id)}/audio/done`, body: { chunks }, ...(key === undefined ? {} : { key }), retry: true },
        AudioDoneResponseSchema,
      ),
    // Groups and keys (PR 27, S2; M28).
    createGroup: (request: CreateGroupRequest): Promise<GroupView> =>
      json({ method: "POST", target: "/v1/groups", body: request, signing: "device", retry: true }, GroupViewSchema),
    groups: async (): Promise<GroupView[]> => (await json({ method: "GET", target: "/v1/groups", retry: true }, GroupListSchema)).groups,
    createInvite: (groupId: string, request: CreateInviteRequest): Promise<InviteView> =>
      json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/invites`, body: request, signing: "device", retry: true }, InviteViewSchema),
    acceptInvite: (token: string): Promise<GroupView> =>
      json({ method: "POST", target: `/v1/invites/${encodeURIComponent(token)}/accept`, signing: "device", retry: true }, GroupViewSchema),
    removeMember: (groupId: string, userId: string): Promise<MembershipEnded> =>
      json(
        { method: "DELETE", target: `/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, signing: "device", retry: true },
        MembershipEndedSchema,
      ),
    groupDevices: (groupId: string): Promise<GroupDevices> =>
      json({ method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/devices`, retry: true }, GroupDevicesSchema),
    groupKeys: (groupId: string, deviceId: string): Promise<MyGroupKeys> =>
      json({ method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/keys?device=${encodeURIComponent(deviceId)}`, retry: true }, MyGroupKeysSchema),
    postGroupKeys: (groupId: string, request: GroupKeysRequest): Promise<GroupKeysResponse> =>
      json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/keys`, body: request, signing: "device", retry: true }, GroupKeysResponseSchema),
    // Sync and media (PR 28, 29; M29). key: the change's own id, so a retried POST is stored once.
    changes: (groupId: string, after: number, limit?: number): Promise<ChangesPage> =>
      json(
        { method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/changes?after=${after}${limit === undefined ? "" : `&limit=${limit}`}`, retry: true },
        ChangesPageSchema,
      ),
    postChange: async (groupId: string, request: PostChangeRequest, key: string): Promise<number> =>
      (await json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/changes`, body: request, key, retry: true }, PostChangeResponseSchema)).seq,
    uploadBlob: (groupId: string, blobId: string, locked: Uint8Array<ArrayBuffer>): Promise<BlobStored> =>
      json(
        {
          method: "POST",
          target: `/v1/blobs?group=${encodeURIComponent(groupId)}&id=${encodeURIComponent(blobId)}`,
          raw: { bytes: locked, contentType: "application/octet-stream" },
          retry: true,
        },
        BlobStoredSchema,
      ),
    blob: (blobId: string): Promise<Uint8Array<ArrayBuffer>> =>
      bytes({ method: "GET", target: `/v1/blobs/${encodeURIComponent(blobId)}`, retry: true, accept: "application/octet-stream" }),
    // The group socket's URL (PR 28). The socket needs the Clerk token in an Authorization header.
    syncSocketUrl: (groupId: string, deviceId: string): string =>
      `${options.baseUrl.replace(/^http/, "ws")}/v1/groups/${encodeURIComponent(groupId)}/sync?device=${encodeURIComponent(deviceId)}`,
    token: (): Promise<string | null> => options.getToken(),
    // Shared links (PR 30; M30b).
    createLink: (request: CreateLinkRequest): Promise<LinkView> =>
      json({ method: "POST", target: "/v1/links", body: request, signing: "device", retry: true }, LinkViewSchema),
    revokeLink: (linkId: string): Promise<LinkRevoked> =>
      json({ method: "DELETE", target: `/v1/links/${encodeURIComponent(linkId)}`, signing: "device", retry: true }, LinkRevokedSchema),
    clockOffset: (): number => clockOffset,
  };
}
