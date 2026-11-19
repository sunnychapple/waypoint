# Wave 3 cards: router, instant tasks, wallet, Clerk webhook (PR 13, 14, 15, 16, 19)

These cards follow `AGENTS.md`, the wave 2 rules (top of "Wave 2" in `docs/build-plan.md`) and the wave 3 notes ("Notes the wave 3 cards must carry"). In short: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no network, no Miniflare, and run `npm run bundle -w @waypoint/api` before opening the pull request and paste its last lines.

Order:

| PR | Branches from | Can run beside |
|---|---|---|
| 13 | `main` | 16, 19 |
| 14 (parts A and B) | `main` after 13 is merged | 16, 19 |
| 15 | `main` after 14 is merged | 16, 19 |
| 16 | `main` | any |
| 19 | `main` | any |

Several cards add lines to `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/wrangler.jsonc` and `packages/contracts/src/index.ts`. Add only your own lines there and leave the rest as it is; conflicts are sorted out when merging.

Route tests build a fresh app instead of using `createApp`, so they need no Clerk token (same pattern as PR 11 and 12):

```ts
const app = new Hono<AppEnv>();
app.onError(handleError);
app.use(async (c, next) => {
  c.set("user", user);
  await next();
});
// then mount the route under test
```

Every code block marked "exactly" below was built and run against `main` at `e53c250` (typecheck, tests and `npm run bundle -w @waypoint/api` all passed). Copy those blocks as they are.

## Decisions these cards make

Recorded in `docs/architecture.md` section 4 by this planning pull request.

1. **Fixed price.** An instant task holds its price from the price table and, once the answer is delivered, settles with `actual` equal to that price. The real model cost (tokens) goes only into the usage event, for Analytics and for flow 8.
2. **Model failure.** If the model call cannot start, the hold is released and the reply is 500 `internal` "model unavailable". If a streamed answer breaks part way, the hold is released and the stream ends with an `error` event. Nothing is charged in either case. The app's "Try again" sends a **new** Idempotency-Key (the old one now gets 409, because its hold is closed).
3. **Zero retention.** A zero-retention user's text is never sent to the router model (it is not confirmed zero-retention); their `explain` routes as "unsure", which is the strong tier. If the route table has no zero-retention entry for the task, the reply is 403 `forbidden` "no zero-retention route for this task", the hold is released, and no model is called. Today no route is zero-retention, so every Plus user with the switch on gets 403 for every instant task until a zero-retention route is added to KV.
4. **Router failure** (error, timeout of 3 s, or an answer that does not parse) routes as "unsure" (strong tier), as architecture section 6 says. The usage event records `router: "failed"`.
5. **More detail and double-check** take the word, the transcript excerpt and the explanation the app is showing (`answer`), because the server keeps nothing between calls. **Double-check answers in one JSON reply, not a stream**, as the API table in section 4 lists it.
6. **Usage events** go to a new queue `waypoint-usage` (binding `USAGE`). These cards only send them; the consumer that writes Analytics Engine and the `activity` table is PR 33. Losing an event never fails a request.
7. **Starter credits.** The Clerk `user.created` webhook grants 25 credits to the **purchased** bucket (purchased credits never expire; a monthly reset would wipe them from the monthly bucket), with command id `starter:<user id>`, so the wallet grants them once however often Clerk retries.
8. **Deleted users.** `user.deleted` deletes the user's D1 row; the schema's `ON DELETE CASCADE` removes their entitlements, devices, recovery row, memberships, jobs, activity and idempotency rows. The wallet Durable Object is left as it is: its ledger is the money record for that billing account (Apple refund notices may still arrive for its purchases), it holds no personal data, and its credits are forfeited, because no account can reach it any more.

---

## PR 13 · Clef router call through AI Gateway

Branch `pr/13-router-call`. No new dependencies. Files: `apps/api/src/ai/gateway.ts`, `apps/api/src/ai/router.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/ai-router.test.ts`. No other files.

Why it looks like this: model ids come from KV, so they are plain strings, and the `Ai` type's string-model overload returns `Record<string, unknown>` while the real call can return a stream. So the code talks to a small `AiBinding` type of its own that returns `unknown`, and a compile-time check proves the real `Ai` binding fits it (the same trick as `d1Fits` in PR 06). What "Clef-flash" replies with is not documented anywhere we could find, so the reply is read defensively: either the OpenAI chat shape or the older `{ response }` shape, JSON found between the first `{` and the last `}`, then `RouterAnswersSchema`. Anything else counts as no answer.

`wrangler.jsonc`: add `"AI_GATEWAY_ID": "waypoint"` to `vars`, and a top-level `"ai": { "binding": "AI" }`. After this card the two lines read:

```jsonc
  "vars": { "CLERK_ISSUER": "https://clerk.example.com", "CLERK_AUTHORIZED_PARTIES": "", "AI_GATEWAY_ID": "waypoint" },
  "ai": { "binding": "AI" },
```

`src/env.ts`: add to `Env`:

```ts
  AI: Ai;
  AI_GATEWAY_ID: string;
```

`src/ai/gateway.ts`, exactly:

```ts
// The part of the Workers AI binding this Worker uses. The real `Ai` binding satisfies this type
// (checked in test/ai-router.test.ts). Model ids come from KV, so they are plain strings.
export type AiBinding = {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options: { gateway: GatewayCallOptions; signal?: AbortSignal },
  ): Promise<unknown>;
};

export type GatewayCallOptions = { id: string; collectLog: false; skipCache: true };

// Every model call goes through AI Gateway with logging and caching off, so the gateway keeps
// neither the text sent nor the answer.
export function gatewayOptions(gatewayId: string): GatewayCallOptions {
  return { id: gatewayId, collectLog: false, skipCache: true };
}

// The text of a finished (not streamed) model reply. Workers AI returns either the OpenAI chat
// shape (choices[0].message.content) or the older { response } shape. Anything else is null.
export function replyText(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  if ("choices" in output && Array.isArray(output.choices)) {
    const first: unknown = output.choices[0];
    if (typeof first === "object" && first !== null && "message" in first) {
      const message: unknown = first.message;
      if (typeof message === "object" && message !== null && "content" in message && typeof message.content === "string") {
        return message.content;
      }
    }
    return null;
  }
  if ("response" in output) {
    if (typeof output.response === "string") return output.response;
    if (typeof output.response === "object" && output.response !== null) return JSON.stringify(output.response);
  }
  return null;
}
```

`src/ai/router.ts`, exactly:

```ts
import type { InstantTask } from "@waypoint/contracts";
import { decideRoute, RouterAnswersSchema, type RouteDecision, type RouterAnswers } from "@waypoint/router";
import type { LoadedConfig } from "../config/load.ts";
import { gatewayOptions, replyText, type AiBinding } from "./gateway.ts";

export const ROUTER_TIMEOUT_MS = 3000;

// Used when the router gives no usable answer, and for zero-retention users (the router model is
// not confirmed zero-retention, so their text is never sent to it). p 0 means "unsure", which the
// router package sends to the strong tier.
export const UNSURE_ANSWERS: RouterAnswers = {
  difficulty: { value: 5, p: 0 },
  needs_web: { value: false, p: 0 },
  subject: { value: "other", p: 0 },
  unsafe: { value: false, p: 0 },
};

export const ROUTER_SYSTEM_PROMPT = [
  "You route a student's request to a model. Do not answer the request.",
  "Reply with one JSON object and nothing else, in exactly this shape:",
  '{"difficulty":{"value":<integer 1-5>,"p":<0-1>},"needs_web":{"value":<true|false>,"p":<0-1>},"subject":{"value":"math"|"science"|"language"|"history"|"other","p":<0-1>},"unsafe":{"value":<true|false>,"p":<0-1>}}',
  "difficulty: how hard a good answer is to write, 1 (a plain definition) to 5 (needs careful expert reasoning).",
  "needs_web: true only if a good answer needs facts newer than or missing from general knowledge.",
  "subject: the school subject. unsafe: true if the request asks for harmful content.",
  "p is your confidence in that value, from 0 to 1.",
].join("\n");

const ROUTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["difficulty", "needs_web", "subject", "unsafe"],
  properties: {
    difficulty: answer({ type: "integer", minimum: 1, maximum: 5 }),
    needs_web: answer({ type: "boolean" }),
    subject: answer({ type: "string", enum: ["math", "science", "language", "history", "other"] }),
    unsafe: answer({ type: "boolean" }),
  },
};

function answer(value: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "p"],
    properties: { value, p: { type: "number", minimum: 0, maximum: 1 } },
  };
}

export type RouterInput = { task: InstantTask; question: string; text: string };

// Asks the router model the four questions. Returns null on any failure: the call throws or
// times out, the reply has no text, the text is not JSON, or the JSON is not RouterAnswers.
export async function askRouter(
  ai: AiBinding,
  gatewayId: string,
  model: string,
  input: RouterInput,
): Promise<RouterAnswers | null> {
  let output: unknown;
  try {
    output = await ai.run(
      model,
      {
        messages: [
          { role: "system", content: ROUTER_SYSTEM_PROMPT },
          { role: "user", content: `Task: ${input.task}\nWord or question: ${input.question}\nText:\n${input.text}` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "router_answers", schema: ROUTER_JSON_SCHEMA, strict: true } },
        temperature: 0,
        max_tokens: 200,
      },
      { gateway: gatewayOptions(gatewayId), signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS) },
    );
  } catch {
    return null;
  }
  const text = replyText(output);
  if (text === null) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = RouterAnswersSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export type RoutedTask = { decision: RouteDecision; router: "ok" | "failed" | "skipped" };

// Picks the route for one instant task. Fixed tasks never call the router. Zero-retention users
// never call it either; they route as unsure. Otherwise a failed router call also routes as unsure.
export async function routeTask(deps: {
  ai: AiBinding;
  gatewayId: string;
  config: LoadedConfig;
  zeroRetention: boolean;
  input: RouterInput;
}): Promise<RoutedTask> {
  const { config, zeroRetention, input } = deps;
  const base = { task: input.task, zeroRetention, routes: config.routes, minConfidence: config.router.min_confidence };
  if (Object.hasOwn(config.routes.fixed, input.task)) {
    return { decision: decideRoute(base), router: "skipped" };
  }
  if (zeroRetention) {
    return { decision: decideRoute({ ...base, answers: UNSURE_ANSWERS }), router: "skipped" };
  }
  const answers = await askRouter(deps.ai, deps.gatewayId, config.router.model, input);
  return {
    decision: decideRoute({ ...base, answers: answers ?? UNSURE_ANSWERS }),
    router: answers === null ? "failed" : "ok",
  };
}
```

Model ids: the route table and `config:router.model` in KV must hold Workers AI ids such as `@cf/zai-org/glm-4.7-flash`. The ids in `DEFAULT_ROUTES` (`workers-ai/...`) are placeholders and are only used in tests; do not change them.

Tests (`test/ai-router.test.ts`). A fake binding in the test file records every call and returns what the test gives it:

```ts
export const aiFits: (ai: Ai) => AiBinding = (ai) => ai;

type Call = { model: string; inputs: Record<string, unknown>; options: Parameters<AiBinding["run"]>[2] };

function fakeAi(reply: () => Promise<unknown>): { ai: AiBinding; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    ai: {
      run: async (model, inputs, options) => {
        calls.push({ model, inputs, options });
        return reply();
      },
    },
  };
}
```

Build a `LoadedConfig` in the test from `PRICE_TABLE_2026_11_16_2`, `DEFAULT_ROUTES` (or a changed copy), `router: { model: "@cf/example/clef-flash", min_confidence: 0.6 }` and any valid flags, min native and voice pack. Input `{ task: "explain", question: "osmosis", text: "SECRET-TRANSCRIPT" }`. A good answer is `{ difficulty: { value: 1, p: 0.9 }, needs_web: { value: false, p: 0.9 }, subject: { value: "science", p: 0.8 }, unsafe: { value: false, p: 0.99 } }`.

- The compile-time check `aiFits` above is in the file.
- `gatewayOptions("g")` equals `{ id: "g", collectLog: false, skipCache: true }`.
- `replyText`: chat shape gives the content; `{ choices: [{ message: { content: null } }] }` gives null; `{ response: "hi" }` gives `"hi"`; `{ response: { a: 1 } }` gives `'{"a":1}'`; `null`, a string and `{}` give null.
- `askRouter` with a chat reply holding the good answer as JSON returns it; the one call used the router model, `options.gateway` equal to `{ id: "gw", collectLog: false, skipCache: true }`, `options.signal` an `AbortSignal`, `inputs.temperature` 0, and the user message contains the text sent.
- `askRouter` with `{ response: <answer object> }` returns the answer.
- `askRouter` with the JSON wrapped in a code fence (```` ```json\n...\n``` ````) returns the answer.
- `askRouter` returns null when: the call throws; the content is `"not json"`; the JSON is `{"difficulty": 3}`; the JSON has an extra key; difficulty value is 6; the reply is a `ReadableStream`; the reply is a string.
- `routeTask` with the good answer: `router: "ok"`, decision ok, tier `light`, model the light entry's model.
- `routeTask` with difficulty 3 → `standard`; with difficulty 2 and `p` 0.5 and `min_confidence` 0.4 → `light` (the config's `min_confidence` is used); with difficulty 2 and `p` 0.5 and `min_confidence` 0.6 → `strong`.
- `routeTask` with `needs_web: { value: true, p: 0.9 }` → `offerResearch: true`.
- `routeTask` for `double_check` makes no AI call, `router: "skipped"`, tier `strong`; for `more_detail` no call, tier `standard`.
- `routeTask` when the call throws → `router: "failed"`, tier `strong`.
- `routeTask` with `zeroRetention: true` and `DEFAULT_ROUTES` makes no AI call and returns `{ router: "skipped", decision: { ok: false, reason: "no_zero_retention_route" } }`.
- `routeTask` with `zeroRetention: true` and a route table whose strong tier is `[{ model: "@cf/zero/strong", retention: "zero" }]` makes no AI call and returns tier `strong`, that model, retention `zero`.

Not in this PR: any endpoint, holding credits, the answer model call, acting on `unsafe` (see open questions in the planning pull request).

---

## PR 14 · `POST /v1/tasks/explain`

Branch `pr/14-explain`. Builds on 13. No new dependencies (`hono/streaming` is part of `hono`). Done in two sittings on the same branch: Part A, commit and push; then Part B.

Flow 1 in architecture section 3, as built here, in order:

1. Check the body (400 on anything wrong; the body is never echoed).
2. Load config (500 "config unavailable" on a `ConfigError`).
3. Hold the fixed price: command id and hold id `explain:<user id>:<Idempotency-Key>`, `expires_at` = now + 60 s + 60 s. A shortfall is 402 with `shortfall`; `hold_closed` is 409 `conflict` "request already finished".
4. Route (PR 13). No route for a zero-retention user: release, 403 `forbidden` "no zero-retention route for this task".
5. Start the model call with `stream: true` through AI Gateway, logging and cache off. If it fails to start: release, usage event `model_failed`, 500 `internal` "model unavailable".
6. Stream the answer to the app as server-sent events. When the model stream ends cleanly with some text: settle with `actual` = the price, usage event `ok`, then a `done` event. If it breaks or has no text: release, usage event `model_failed`, then an `error` event.

The reply to a task is never stored (no `idempotent()` store), and nothing else is written: only the wallet's hold, settle or release (task name, ids, credits) and the usage event (sizes, route, credits). No log line, D1 row, KV, R2 or event holds the word, the transcript or the answer.

The streamed reply (`Content-Type: text/event-stream`) is any number of

```
event: delta
data: {"text":"Water moves "}
```

then exactly one of

```
event: done
data: {"credits":1,"tier":"light","retention":"standard","offer_research":false}

event: error
data: {"code":"internal","message":"model failed","retry_after":null}
```

and then the stream ends. `offer_research` is true when the router said the question needs the web, so the app can offer "Research the web".

### Part A

Files: `packages/contracts/src/instant.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/instant.test.ts`, `apps/api/src/ai/stream.ts`, `apps/api/src/usage.ts`, `apps/api/test/model-stream.test.ts`.

`packages/contracts/src/instant.ts`, exactly:

```ts
import { z } from "zod";

// Limits on the text an instant task may send. About 54 s of speech is under 1,000 characters,
// so 4,000 leaves room without letting a whole lecture through.
export const WORD_MAX_CHARS = 100;
export const TRANSCRIPT_MAX_CHARS = 4000;

export const ExplainRequestSchema = z.strictObject({
  word: z.string().trim().min(1).max(WORD_MAX_CHARS),
  transcript: z.string().trim().min(1).max(TRANSCRIPT_MAX_CHARS),
});

export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

// A streamed task answers with server-sent events: any number of "delta" events, then exactly one
// "done" or one "error" event, then the stream ends.
export const StreamDeltaSchema = z.strictObject({ text: z.string().min(1) });

export const StreamDoneSchema = z.strictObject({
  credits: z.number().int().min(0),
  tier: z.enum(["light", "standard", "strong"]),
  retention: z.enum(["standard", "zero"]),
  offer_research: z.boolean(),
});

export type StreamDelta = z.infer<typeof StreamDeltaSchema>;
export type StreamDone = z.infer<typeof StreamDoneSchema>;
```

`packages/contracts/src/index.ts`: add `export * from "./instant.ts";`.

`apps/api/src/ai/stream.ts`, exactly. Workers AI streams server-sent events; newer models send OpenAI chat chunks, older ones `{ "response": ... }`, so both are read.

```ts
export type StreamResult = { chars: number; tokens_in: number | null; tokens_out: number | null };

// Reads a Workers AI streamed reply (server-sent events, "data: <json>" lines, ending with
// "data: [DONE]") and calls onText with each piece of answer text, in order. Both reply shapes are
// read: { choices: [{ delta: { content } }] } and { response }. Reasoning text is never passed on.
// Throws if the stream fails or a data line is not JSON. The text itself is not kept.
export async function readModelStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => Promise<void>,
): Promise<StreamResult> {
  const result: StreamResult = { chars: 0, tokens_in: null, tokens_out: null };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const handleLine = async (line: string): Promise<void> => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "") return;
    if (payload === "[DONE]") {
      finished = true;
      return;
    }
    const chunk: unknown = JSON.parse(payload);
    const text = deltaText(chunk);
    if (text !== null && text !== "") {
      result.chars += text.length;
      await onText(text);
    }
    readUsage(chunk, result);
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line.replace(/\r$/, ""));
        if (finished) break;
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer !== "") await handleLine(buffer.replace(/\r$/, ""));
    }
  } finally {
    if (finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return result;
}

function deltaText(chunk: unknown): string | null {
  if (typeof chunk !== "object" || chunk === null) return null;
  if ("choices" in chunk && Array.isArray(chunk.choices)) {
    const first: unknown = chunk.choices[0];
    if (typeof first === "object" && first !== null && "delta" in first) {
      const delta: unknown = first.delta;
      if (typeof delta === "object" && delta !== null && "content" in delta && typeof delta.content === "string") {
        return delta.content;
      }
    }
    return null;
  }
  if ("response" in chunk && typeof chunk.response === "string") return chunk.response;
  return null;
}

// Copies the token counts from a reply or stream chunk that has a usage object.
export function readUsage(chunk: unknown, result: { tokens_in: number | null; tokens_out: number | null }): void {
  if (typeof chunk !== "object" || chunk === null || !("usage" in chunk)) return;
  const usage: unknown = chunk.usage;
  if (typeof usage !== "object" || usage === null) return;
  if ("prompt_tokens" in usage && Number.isSafeInteger(usage.prompt_tokens)) result.tokens_in = Number(usage.prompt_tokens);
  if ("completion_tokens" in usage && Number.isSafeInteger(usage.completion_tokens)) result.tokens_out = Number(usage.completion_tokens);
}
```

`apps/api/src/usage.ts`, exactly:

```ts
import type { InstantTask } from "@waypoint/contracts";
import type { Tier } from "@waypoint/router";

// One event per model call, for Analytics Engine and the activity list (PR 33 consumes them).
// Sizes, credits and route only: never the text sent or the answer.
export type UsageEvent = {
  v: 1;
  at: number;
  user_id: string;
  task: InstantTask;
  outcome: "ok" | "model_failed";
  credits: number;
  tier: Tier;
  model: string;
  retention: "standard" | "zero";
  router: "ok" | "failed" | "skipped";
  bytes_sent: number;
  tokens_in: number | null;
  tokens_out: number | null;
};

// The part of a Queue producer binding this Worker uses. Queue<UsageEvent> satisfies this type.
export type UsageQueue = { send(event: UsageEvent): Promise<unknown> };

// A lost usage event must never fail or change the person's request.
export async function sendUsage(queue: UsageQueue, event: UsageEvent): Promise<void> {
  try {
    await queue.send(event);
  } catch {
    // Dropped; the wallet ledger still has the charge.
  }
}
```

`task` is typed from `InstantTask`, never from request text (the wave 3 note for the first card that feeds `activity`). `credits` is the settle result's `charged` (0 when released).

Part A tests.

`packages/contracts/test/instant.test.ts`:
- `{ word: "osmosis", transcript: "the cell takes in water" }` parses; `" osmosis "` comes back as `"osmosis"`.
- Rejected: word `""`, word `"   "`, word of 101 characters, transcript `""`, transcript of 4,001 characters, a missing field, an extra key, a number for `word`. Accepted: word of 100 and transcript of 4,000 characters.
- `StreamDeltaSchema` rejects `{ text: "" }`; `StreamDoneSchema` accepts `{ credits: 0, tier: "strong", retention: "zero", offer_research: true }` and rejects `credits: -1`, `tier: "huge"` and an extra key.

`apps/api/test/model-stream.test.ts`, with a `sse(chunks: string[])` helper in the test that returns a `ReadableStream<Uint8Array>` enqueuing each string encoded and then closing (copy it from `test/helpers/tasks.ts` in Part B, or write the same function), and an `onText` that pushes into an array:
- Chat chunks `"Water "`, `"moves."`, then `data: [DONE]` → `onText` got `["Water ", "moves."]`, `chars` 12.
- `{ "response": ... }` chunks are read the same way.
- A chunk with `"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":9}` gives `tokens_in` 120, `tokens_out` 9; no usage gives both null.
- One event split across two chunks in the middle of the JSON is read once, whole.
- `\r\n` line endings work.
- A chunk with only `reasoning_content` in `delta` calls `onText` nothing.
- Lines after `data: [DONE]` are ignored (put a content chunk after it: not passed on).
- A stream that ends without `[DONE]` returns normally with what it read, including a last line with no trailing newline.
- `data: {bad json` throws.
- A stream that errors (`controller.error(new Error("x"))` after one chunk) throws, after passing on the first chunk.
- Empty `content` strings are not passed on and add nothing to `chars`.
- `readUsage` on `{ usage: { prompt_tokens: 1.5 } }` leaves `tokens_in` null.
- `sendUsage` with a queue whose `send` throws resolves without throwing; with a working queue the event is sent once, unchanged.
- Compile-time check: `export const usageQueueFits: (queue: Queue<UsageEvent>) => UsageQueue = (queue) => queue;`.

### Part B

Files: `apps/api/src/tasks/instant.ts`, `apps/api/src/tasks/explain.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/helpers/tasks.ts`, `apps/api/test/explain.test.ts`, `apps/api/test/app.test.ts` (new test only).

`wrangler.jsonc`: add a top-level

```jsonc
  "queues": { "producers": [{ "binding": "USAGE", "queue": "waypoint-usage" }] },
```

`src/env.ts`: add `import type { UsageEvent } from "./usage.ts";` and `USAGE: Queue<UsageEvent>;` to `Env`.

`src/tasks/instant.ts`, exactly. These are the pieces PR 15 reuses.

```ts
import { apiError, IDEMPOTENCY_KEY_HEADER, isValidIdempotencyKey, type StreamDone } from "@waypoint/contracts";
import { quoteCredits } from "@waypoint/pricing";
import type { Tier } from "@waypoint/router";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { gatewayOptions, type AiBinding } from "../ai/gateway.ts";
import { routeTask } from "../ai/router.ts";
import { readModelStream, type StreamResult } from "../ai/stream.ts";
import { ConfigError, loadConfig } from "../config/load.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { sendUsage } from "../usage.ts";

export type InstantTaskName = "explain" | "more_detail" | "double_check";

// How long the model may run for each task. A hold lives this long plus HOLD_MARGIN_MS, so it is
// always still open when the task settles (decision D3).
export const TASK_TIME_LIMIT_MS: Record<InstantTaskName, number> = {
  explain: 60_000,
  more_detail: 90_000,
  double_check: 120_000,
};
export const HOLD_MARGIN_MS = 60_000;

export type ChatMessage = { role: "system" | "user"; content: string };

// Everything a running task needs after its credits are held and its route is picked.
export type HeldTask = {
  task: InstantTaskName;
  userId: string;
  credits: number;
  holdId: string;
  settleId: string;
  releaseId: string;
  tier: Tier;
  model: string;
  retention: "standard" | "zero";
  offerResearch: boolean;
  router: "ok" | "failed" | "skipped";
  bytesSent: number;
};

// Reads and checks the JSON body. Never echoes the body or zod's messages.
export async function readTaskBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  const body: unknown = await c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
  return parsed.data;
}

export function utf8Bytes(...parts: string[]): number {
  const encoder = new TextEncoder();
  return parts.reduce((sum, part) => sum + encoder.encode(part).byteLength, 0);
}

function wallet(c: Context<AppEnv>) {
  const user = c.get("user");
  return c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
}

// Holds the task's fixed price, then picks the route. Throws the right ApiFailure when the task
// must not run; in that case no hold is left open.
export async function holdAndRoute(
  c: Context<AppEnv>,
  input: { task: InstantTaskName; question: string; text: string; bytesSent: number },
  now: number,
): Promise<HeldTask> {
  const user = c.get("user");
  const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
  if (key === undefined || !isValidIdempotencyKey(key)) {
    throw new ApiFailure("bad_request", "Idempotency-Key header required");
  }
  const config = await loadConfig(c.env.CONFIG).catch((err: unknown) => {
    if (err instanceof ConfigError) throw new ApiFailure("internal", "config unavailable");
    throw err;
  });
  const credits = quoteCredits(config.prices, { task: input.task });

  const holdId = `${input.task}:${user.id}:${key}`;
  const settleId = `${input.task}_settle:${user.id}:${key}`;
  const releaseId = `${input.task}_release:${user.id}:${key}`;
  const held = await wallet(c).apply({
    type: "hold",
    id: holdId,
    hold_id: holdId,
    user_id: user.id,
    task: input.task,
    credits,
    expires_at: now + TASK_TIME_LIMIT_MS[input.task] + HOLD_MARGIN_MS,
  });
  if (!held.ok) {
    if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
    if (held.reason === "hold_closed") throw new ApiFailure("conflict", "request already finished");
    throw new ApiFailure("internal", "something went wrong");
  }

  const ai: AiBinding = c.env.AI;
  const { decision, router } = await routeTask({
    ai,
    gatewayId: c.env.AI_GATEWAY_ID,
    config,
    zeroRetention: user.zero_retention,
    input: { task: input.task, question: input.question, text: input.text },
  });
  if (!decision.ok) {
    await wallet(c).apply({ type: "release", id: releaseId, hold_id: holdId }).catch(() => undefined);
    throw new ApiFailure("forbidden", "no zero-retention route for this task");
  }
  return {
    task: input.task,
    userId: user.id,
    credits,
    holdId,
    settleId,
    releaseId,
    tier: decision.tier,
    model: decision.model,
    retention: decision.retention,
    offerResearch: decision.offerResearch,
    router,
    bytesSent: input.bytesSent,
  };
}

// Settles the hold at the task's fixed price when the answer was delivered, else releases it, then
// sends the usage event. Never throws. Returns the credits charged (0 when released or on error).
export async function finishTask(
  c: Context<AppEnv>,
  held: HeldTask,
  outcome: "ok" | "model_failed",
  tokens: { tokens_in: number | null; tokens_out: number | null },
  now: number,
): Promise<number> {
  let charged = 0;
  if (outcome === "ok") {
    const result = await wallet(c)
      .apply({ type: "settle", id: held.settleId, hold_id: held.holdId, actual: held.credits })
      .catch(() => null);
    if (result !== null && result.ok && "charged" in result) charged = result.charged;
  } else {
    await wallet(c).apply({ type: "release", id: held.releaseId, hold_id: held.holdId }).catch(() => undefined);
  }
  await sendUsage(c.env.USAGE, {
    v: 1,
    at: now,
    user_id: held.userId,
    task: held.task,
    outcome,
    credits: charged,
    tier: held.tier,
    model: held.model,
    retention: held.retention,
    router: held.router,
    bytes_sent: held.bytesSent,
    tokens_in: tokens.tokens_in,
    tokens_out: tokens.tokens_out,
  });
  return charged;
}

const NO_TOKENS = { tokens_in: null, tokens_out: null };

// Starts the model call and streams the answer as server-sent events ("delta", then "done" or
// "error"). If the call cannot start, the hold is released and the reply is 500 "model unavailable".
export async function streamTask(
  c: Context<AppEnv>,
  held: HeldTask,
  prompt: { messages: ChatMessage[]; maxTokens: number },
  now: () => number,
): Promise<Response> {
  const ai: AiBinding = c.env.AI;
  let stream: ReadableStream<Uint8Array>;
  try {
    const output = await ai.run(
      held.model,
      {
        messages: prompt.messages,
        stream: true,
        max_tokens: prompt.maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      },
      { gateway: gatewayOptions(c.env.AI_GATEWAY_ID), signal: AbortSignal.timeout(TASK_TIME_LIMIT_MS[held.task]) },
    );
    if (!(output instanceof ReadableStream)) throw new Error("not a stream");
    stream = output;
  } catch {
    await finishTask(c, held, "model_failed", NO_TOKENS, now());
    throw new ApiFailure("internal", "model unavailable");
  }

  return streamSSE(c, async (sse) => {
    let result: StreamResult | null = null;
    try {
      result = await readModelStream(stream, (text) => sse.writeSSE({ event: "delta", data: JSON.stringify({ text }) }));
    } catch {
      result = null;
    }
    if (result === null || result.chars === 0) {
      await finishTask(c, held, "model_failed", result ?? NO_TOKENS, now());
      await sse.writeSSE({ event: "error", data: JSON.stringify(apiError("internal", "model failed")) });
      return;
    }
    const charged = await finishTask(c, held, "ok", result, now());
    const done: StreamDone = {
      credits: charged,
      tier: held.tier,
      retention: held.retention,
      offer_research: held.offerResearch,
    };
    await sse.writeSSE({ event: "done", data: JSON.stringify(done) });
  });
}
```

Notes on this file, so the reviewer can check them:
- The hold comes before the router call, so a person with no credits costs no model call. Zero-retention users make no model call before the 403.
- Settle and the usage event happen inside the stream callback, before the stream closes, so the Worker is still running. Hono's `writeSSE` ignores write errors, so a person who closes the app mid-answer is still settled. If the Worker is stopped first, the hold expires and the wallet's alarm releases it: that answer is free.
- A retry with the same key while the first request's hold is still open runs again; the wallet charges once (the settle id replays).
- `chat_template_kwargs: { enable_thinking: false }` turns off reasoning on the current candidate models (GLM 4.7 Flash, Kimi K2.6, DeepSeek V4 Flash all accept it), so the answer starts at once and reasoning does not use up `max_tokens`.

`src/tasks/explain.ts`, exactly:

```ts
import { ExplainRequestSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { holdAndRoute, readTaskBody, streamTask, utf8Bytes, type ChatMessage } from "./instant.ts";

export const EXPLAIN_MAX_TOKENS = 500;

export const EXPLAIN_SYSTEM_PROMPT = [
  "You explain a word or phrase a school student just heard in class.",
  "Use the transcript excerpt only to work out which meaning the teacher meant.",
  "Answer in two to four short sentences, in plain words. Start with the meaning, not with the word.",
  "If the excerpt does not make the meaning clear, give the most likely meaning and say that you are not sure.",
].join("\n");

export function explainRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().post("/v1/tasks/explain", async (c) => {
    const request = await readTaskBody(c, ExplainRequestSchema);
    const held = await holdAndRoute(
      c,
      {
        task: "explain",
        question: request.word,
        text: request.transcript,
        bytesSent: utf8Bytes(request.word, request.transcript),
      },
      deps.now(),
    );
    const messages: ChatMessage[] = [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
      { role: "user", content: `Word: ${request.word}\n\nTranscript excerpt:\n${request.transcript}` },
    ];
    return streamTask(c, held, { messages, maxTokens: EXPLAIN_MAX_TOKENS }, deps.now);
  });
}
```

`src/app.ts`: `import { explainRoute } from "./tasks/explain.ts";` and, under the quote route, `app.route("/", explainRoute(deps));` (`deps` is the `SessionDeps` `createApp` already takes; it has `now`).

`test/helpers/tasks.ts`, exactly. PR 15 reuses it. The wallet is the real wallet store on `createTestStore()`, so holds, settles and releases run the real ledger rules.

```ts
// Stand-ins for the instant task routes (PR 14): KV config, a real wallet store on node:sqlite,
// a fake Workers AI binding and a usage queue that records events.
import type { Command } from "@waypoint/ledger";
import { PRICE_TABLE_2026_11_16_2 } from "@waypoint/pricing";
import { DEFAULT_ROUTES, type RouteTable } from "@waypoint/router";
import type { AiBinding } from "../../src/ai/gateway.ts";
import type { UsageEvent, UsageQueue } from "../../src/usage.ts";
import { createWalletStore } from "../../src/wallet/store.ts";
import { createTestStore } from "./sql.ts";

export const TASK_NOW = 1_800_000_000_000;

export const GOOD_ANSWERS = {
  difficulty: { value: 1, p: 0.9 },
  needs_web: { value: false, p: 0.9 },
  subject: { value: "science", p: 0.9 },
  unsafe: { value: false, p: 0.9 },
};

export function configEntries(routes: RouteTable = DEFAULT_ROUTES): Record<string, unknown> {
  return {
    "config:current": { prices: "2026-11-16.2", routes: routes.version },
    "config:prices:2026-11-16.2": PRICE_TABLE_2026_11_16_2,
    [`config:routes:${routes.version}`]: routes,
    "config:router": { model: "@cf/example/router", min_confidence: 0.6 },
    "config:flags": {},
    "config:min-native": { ios: "1.4.0" },
    "config:voice-pack": { version: "v1", url: "https://packs.example.com/v.zip", sha256: "ab".repeat(32), size: 1 },
  };
}

// A model stream that sends these strings and then ends.
export function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

// A model stream that sends one string and then fails.
export function failingStream(first: string): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.error(new Error("upstream reset"));
        return;
      }
      sent = true;
      controller.enqueue(new TextEncoder().encode(first));
    },
  });
}

export const goodStream = (): ReadableStream<Uint8Array> =>
  sse([
    'data: {"choices":[{"delta":{"content":"Water moves "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"across a membrane."}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":9}}\n\n',
    "data: [DONE]\n\n",
  ]);

// Reads the whole server-sent event reply (it ends when the route closes it) into records.
export async function readEvents(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      return { event, data: JSON.parse(data) as unknown };
    });
}

export type TaskEnvOptions = {
  // What the model call with stream: true returns (default goodStream()).
  stream?: () => Promise<unknown>;
  // What any other model call returns: the router, and double-check (default GOOD_ANSWERS as chat JSON).
  reply?: () => Promise<unknown>;
  monthly?: number;
  routes?: RouteTable;
  usageFails?: boolean;
};

export type AiCall = { model: string; inputs: Record<string, unknown>; options: Parameters<AiBinding["run"]>[2] };

export function makeTaskEnv(options: TaskEnvOptions = {}) {
  const store = createWalletStore(createTestStore());
  const monthly = options.monthly ?? 10;
  if (monthly > 0) store.apply({ type: "grant", id: "seed", bucket: "monthly", credits: monthly, ref: "test" }, TASK_NOW);
  const commands: Command[] = [];
  const walletNames: string[] = [];
  const aiCalls: AiCall[] = [];
  const events: UsageEvent[] = [];
  const map = new Map(Object.entries(configEntries(options.routes)));

  const WALLET = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      walletNames.push(id);
      return {
        apply: async (command: Command) => {
          commands.push(command);
          return store.apply(command, TASK_NOW);
        },
      };
    },
  };
  const AI: AiBinding = {
    run: async (model, inputs, callOptions) => {
      aiCalls.push({ model, inputs, options: callOptions });
      if (inputs["stream"] === true) return (options.stream ?? (async () => goodStream()))();
      return (options.reply ?? (async () => ({ choices: [{ message: { content: JSON.stringify(GOOD_ANSWERS) } }] })))();
    },
  };
  const USAGE: UsageQueue = {
    send: async (event) => {
      if (options.usageFails === true) throw new Error("queue down");
      events.push(event);
    },
  };
  const CONFIG = { get: async (key: string) => map.get(key) ?? null };
  const env = { CONFIG, WALLET, AI, USAGE, AI_GATEWAY_ID: "gw-test" };
  return { env, store, commands, walletNames, aiCalls, events };
}
```

How the tests read the stream: `await readEvents(res)`. `res.text()` resolves when the route closes the stream, which it does after the `done` or `error` event, so the wallet and usage checks can run right after it.

Tests (`test/explain.test.ts`). User `{ id: "u1", clerk_id: "user_1", plan: "free", billing_account_id: "ba1", zero_retention: false }`, key `abcdefghijklmnop`, `explainRoute({ now: () => TASK_NOW })` in the fresh app, and a body whose transcript contains the marker `SECRET-TRANSCRIPT-7f3a`. Each bullet is one test:
- Happy path: 200, `Content-Type` contains `text/event-stream`; events are `delta`, `delta`, `done`; the delta texts (each passing `StreamDeltaSchema`) join to `"Water moves across a membrane."`; `done` passes `StreamDoneSchema` and equals `{ credits: 1, tier: "light", retention: "standard", offer_research: false }`; the wallet has monthly 9 and no holds; the commands are a `hold` with id and `hold_id` `explain:u1:abcdefghijklmnop`, `task` `"explain"`, `credits` 1, `expires_at` `TASK_NOW + 60_000 + 60_000`, then a `settle` with id `explain_settle:u1:abcdefghijklmnop` and `actual` 1; every wallet lookup used `"ba1"`.
- The one usage event equals `{ v: 1, at: TASK_NOW, user_id: "u1", task: "explain", outcome: "ok", credits: 1, tier: "light", model: "workers-ai/glm-4.7-flash", retention: "standard", router: "ok", bytes_sent: <UTF-8 bytes of word + transcript>, tokens_in: 120, tokens_out: 9 }`.
- Two AI calls: first the router (`config:router` model, no `stream`), then the answer model with `inputs` matching `{ stream: true, max_tokens: 500, chat_template_kwargs: { enable_thinking: false } }`, `options.gateway` equal to `{ id: "gw-test", collectLog: false, skipCache: true }` and `options.signal` an `AbortSignal`. The user message contains the word and the transcript.
- `bytes_sent` counts bytes, not characters: a word `"é"` adds 2.
- Router says `needs_web` with p 0.9 → `done.offer_research` true.
- Monthly 0 → 402, body passes `InsufficientCreditsErrorSchema` with `shortfall` 1; no AI call, no usage event.
- The same key again after a finished request → 409 `{ code: "conflict", message: "request already finished", retry_after: null }`; no new AI call; monthly still 9.
- The same key while that hold is still open (apply the same `hold` command to `store` by hand first, `expires_at` `TASK_NOW + 5`) → 200 with `done`; monthly 9 (charged once).
- The model call throws → 500 `{ code: "internal", message: "model unavailable", retry_after: null }`; commands `hold`, `release`; monthly 10, no holds; one usage event with `outcome: "model_failed"`, `credits: 0`.
- After that failure, the same key again → 409 (the hold is closed); a new key → runs.
- The model returns a plain object instead of a stream → 500 "model unavailable", released.
- The stream fails after one chunk (`failingStream('data: {"response":"Water "}\n\n')`) → 200, events `delta`, `error`; the error data passes `ApiErrorSchema` and equals `{ code: "internal", message: "model failed", retry_after: null }`; monthly 10, no holds; usage `model_failed`.
- A stream with only `data: [DONE]` → events `error` only; released.
- A stream with a bad JSON line → `error`; released.
- Zero-retention user with `DEFAULT_ROUTES` → 403 `{ code: "forbidden", message: "no zero-retention route for this task", retry_after: null }`; no AI call; commands `hold`, `release`; monthly 10.
- Zero-retention user with a route table whose strong tier is `[{ model: "@cf/zero/strong", retention: "zero" }]` → `done` equals `{ credits: 1, tier: "strong", retention: "zero", offer_research: false }`; the only AI call is to `@cf/zero/strong` (no router call).
- Router reply `"no idea"` → `done.tier` `strong`; usage `router: "failed"`, model `workers-ai/kimi-k2.6`.
- Usage queue `send` throws → the stream still ends with `done`, monthly 9.
- 400 `bad_request` "invalid request", with no wallet command and no AI call, for: bad JSON, `word: ""`, word of 101 characters, transcript of 4,001 characters, missing `transcript`, an extra key. A transcript of exactly 4,000 characters → 200. No 400 body contains the marker.
- No `Idempotency-Key` header → 400 "Idempotency-Key header required".
- `config:current` missing → 500 "config unavailable", no wallet command.
- Privacy: with `vi.spyOn` on `console.log`, `error`, `warn`, `info` and `debug`, run one good and one failing request; no console method was called, and `JSON.stringify` of the commands and of the usage events does not contain the marker.

`test/app.test.ts` (add, change nothing else): through `createApp`, `POST /v1/tasks/explain` with no `Authorization` header gives 401.

Not in this PR: more detail and double-check (PR 15), the usage queue consumer, Analytics Engine and `activity` rows (PR 33), rate limits, acting on `unsafe`.

---

## PR 15 · `POST /v1/tasks/more-detail` and `POST /v1/tasks/double-check`

Branch `pr/15-more-detail-double-check`. Builds on 14. No new dependencies. Files: `packages/contracts/src/instant.ts` (add to the end), `packages/contracts/test/instant.test.ts` (add tests), `apps/api/src/tasks/instant.ts` (two import lines and one function), `apps/api/src/tasks/more-detail.ts`, `apps/api/src/tasks/double-check.ts`, `apps/api/src/app.ts` (two imports, two lines), `apps/api/test/follow-up.test.ts`, `apps/api/test/app.test.ts` (new tests only).

Both tasks have a fixed tier in the route table (`more_detail` standard, `double_check` strong), so `routeTask` never calls the router for them. Prices: `more_detail` 3, `double_check` 4. More detail streams exactly like explain. Double-check answers in one JSON reply (the API table does not mark it as a stream).

`packages/contracts/src/instant.ts`: add at the end, exactly:

```ts

// More detail and double-check also send the explanation the app already shows.
export const ANSWER_MAX_CHARS = 4000;

export const FollowUpRequestSchema = ExplainRequestSchema.extend({
  answer: z.string().trim().min(1).max(ANSWER_MAX_CHARS),
});

export type FollowUpRequest = z.infer<typeof FollowUpRequestSchema>;

export const DoubleCheckResponseSchema = z.strictObject({
  text: z.string().min(1),
  credits: z.number().int().min(0),
  tier: z.enum(["light", "standard", "strong"]),
  retention: z.enum(["standard", "zero"]),
});

export type DoubleCheckResponse = z.infer<typeof DoubleCheckResponseSchema>;
```

`apps/api/src/tasks/instant.ts`: change the two imports to

```ts
import { gatewayOptions, replyText, type AiBinding } from "../ai/gateway.ts";
import { readModelStream, readUsage, type StreamResult } from "../ai/stream.ts";
```

and add at the end, exactly:

```ts

// Runs the model without streaming and returns the whole answer. If the call fails or the answer
// is empty, the hold is released and the reply is 500 "model unavailable".
export async function answerTask(
  c: Context<AppEnv>,
  held: HeldTask,
  prompt: { messages: ChatMessage[]; maxTokens: number },
  now: () => number,
): Promise<{ text: string; charged: number }> {
  const ai: AiBinding = c.env.AI;
  const tokens: { tokens_in: number | null; tokens_out: number | null } = { tokens_in: null, tokens_out: null };
  let text: string | null = null;
  try {
    const output = await ai.run(
      held.model,
      { messages: prompt.messages, max_tokens: prompt.maxTokens, chat_template_kwargs: { enable_thinking: false } },
      { gateway: gatewayOptions(c.env.AI_GATEWAY_ID), signal: AbortSignal.timeout(TASK_TIME_LIMIT_MS[held.task]) },
    );
    text = replyText(output);
    readUsage(output, tokens);
  } catch {
    text = null;
  }
  if (text === null || text.trim() === "") {
    await finishTask(c, held, "model_failed", tokens, now());
    throw new ApiFailure("internal", "model unavailable");
  }
  const charged = await finishTask(c, held, "ok", tokens, now());
  return { text, charged };
}
```

Change nothing else in `instant.ts`.

`src/tasks/more-detail.ts`, exactly:

```ts
import { FollowUpRequestSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { holdAndRoute, readTaskBody, streamTask, utf8Bytes, type ChatMessage } from "./instant.ts";

export const MORE_DETAIL_MAX_TOKENS = 1200;

export const MORE_DETAIL_SYSTEM_PROMPT = [
  "A school student read a short explanation of a word they heard in class and asked for more detail.",
  "Build on the explanation: add how it works, one example, and how it connects to what the teacher was saying.",
  "Use plain words and at most three short paragraphs. Do not repeat the explanation.",
  "If the explanation is wrong, say so first and correct it.",
].join("\n");

export function moreDetailRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().post("/v1/tasks/more-detail", async (c) => {
    const request = await readTaskBody(c, FollowUpRequestSchema);
    const held = await holdAndRoute(
      c,
      {
        task: "more_detail",
        question: request.word,
        text: request.transcript,
        bytesSent: utf8Bytes(request.word, request.transcript, request.answer),
      },
      deps.now(),
    );
    const messages: ChatMessage[] = [
      { role: "system", content: MORE_DETAIL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Word: ${request.word}\n\nTranscript excerpt:\n${request.transcript}\n\nExplanation so far:\n${request.answer}`,
      },
    ];
    return streamTask(c, held, { messages, maxTokens: MORE_DETAIL_MAX_TOKENS }, deps.now);
  });
}
```

`src/tasks/double-check.ts`, exactly:

```ts
import { FollowUpRequestSchema, type DoubleCheckResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { answerTask, holdAndRoute, readTaskBody, utf8Bytes, type ChatMessage } from "./instant.ts";

export const DOUBLE_CHECK_MAX_TOKENS = 600;

export const DOUBLE_CHECK_SYSTEM_PROMPT = [
  "You check an explanation that was given to a school student about a word they heard in class.",
  "Use the transcript excerpt to see what the teacher meant.",
  "Start with one line: Correct, Partly correct, or Not correct.",
  "Then explain in at most four short sentences what is right, what is wrong, and the correct version, in plain words.",
].join("\n");

export function doubleCheckRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().post("/v1/tasks/double-check", async (c) => {
    const request = await readTaskBody(c, FollowUpRequestSchema);
    const held = await holdAndRoute(
      c,
      {
        task: "double_check",
        question: request.word,
        text: request.transcript,
        bytesSent: utf8Bytes(request.word, request.transcript, request.answer),
      },
      deps.now(),
    );
    const messages: ChatMessage[] = [
      { role: "system", content: DOUBLE_CHECK_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Word: ${request.word}\n\nTranscript excerpt:\n${request.transcript}\n\nExplanation to check:\n${request.answer}`,
      },
    ];
    const { text, charged } = await answerTask(c, held, { messages, maxTokens: DOUBLE_CHECK_MAX_TOKENS }, deps.now);
    const reply: DoubleCheckResponse = { text, credits: charged, tier: held.tier, retention: held.retention };
    return c.json(reply);
  });
}
```

The double-check reply holds content, so it is never stored; a retry with the same key after it finished gets 409 "request already finished", like explain.

`src/app.ts`: import both and add `app.route("/", moreDetailRoute(deps));` and `app.route("/", doubleCheckRoute(deps));` under the explain line.

Tests.

`packages/contracts/test/instant.test.ts` (add): `FollowUpRequestSchema` accepts word, transcript and answer; rejects a missing `answer`, `answer: "  "`, an answer of 4,001 characters and an extra key; accepts 4,000. `DoubleCheckResponseSchema` accepts a good reply and rejects `text: ""` and an extra key.

`test/follow-up.test.ts`, using `makeTaskEnv`, `readEvents` and `TASK_NOW` from `test/helpers/tasks.ts`, the fresh app with both routes mounted, the same user and key as PR 14, and a body `{ word: "osmosis", transcript: "... SECRET-TRANSCRIPT-7f3a", answer: "It is water moving. SECRET-ANSWER-91c2" }`:
- More detail, happy path: events end with `done` equal to `{ credits: 3, tier: "standard", retention: "standard", offer_research: false }`; exactly one AI call (no router), to `workers-ai/deepseek-v4.1-flash`, `inputs` matching `{ stream: true, max_tokens: 1200 }`; the user message contains the answer; monthly 7; commands `hold` `more_detail:u1:<key>` with `credits` 3 and `expires_at` `TASK_NOW + 90_000 + 60_000`, then `settle` `more_detail_settle:u1:<key>`; usage event `task: "more_detail"`, `credits: 3`, `router: "skipped"`, `bytes_sent` the bytes of all three strings.
- More detail, stream fails after one chunk → `error` event, released, monthly 10.
- More detail, monthly 2 → 402 with `shortfall` 1.
- Double-check, happy path with `reply` returning `{ choices: [{ message: { content: "Correct. Osmosis is..." } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }`: 200 JSON passing `DoubleCheckResponseSchema` and equal to `{ text: "Correct. Osmosis is...", credits: 4, tier: "strong", retention: "standard" }`; one AI call to `workers-ai/kimi-k2.6` with no `stream` key and `max_tokens` 600, gateway options as in PR 14; monthly 6; commands `double_check:u1:<key>` (`expires_at` `TASK_NOW + 120_000 + 60_000`) then `double_check_settle:u1:<key>`; usage `tokens_in` 5, `tokens_out` 3.
- Double-check with the older `{ response: "Correct." }` reply → 200, text `"Correct."`.
- Double-check, model throws → 500 "model unavailable", released, usage `model_failed`.
- Double-check, content `"   "` → 500 "model unavailable", released.
- Double-check, same key after success → 409 "request already finished", one AI call in total.
- Zero-retention user with `DEFAULT_ROUTES` → 403 on both endpoints, no AI call, monthly 10.
- Zero-retention user with a zero entry only in the light tier → 403 for both (fixed tiers do not move down).
- 400 for a missing `answer` on both endpoints; no wallet command.
- Privacy: no console method called; neither marker appears in the commands or the usage events.

`test/app.test.ts` (add): through `createApp`, both endpoints with no `Authorization` header give 401.

Not in this PR: research, read-link, threads of more than one follow-up.

---

## PR 16 · `GET /v1/wallet` and `GET /v1/wallet/ledger`

Branch `pr/16-wallet-endpoints`. Builds on 08 and 12 (merged). No new dependencies. Files: `packages/contracts/src/wallet.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/wallet.test.ts`, `apps/api/src/wallet/route.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/wallet-route.test.ts`, `apps/api/test/app.test.ts` (new test only).

Both endpoints read only. They are `GET`, so they need no Idempotency-Key, and they never use the PR 11 store. As the wave 3 note says, the ledger endpoint returns the ledger rows and the open hold ids; what a task cost comes from `activity` and `jobs.spent`, not from adding up ledger rows.

`packages/contracts/src/wallet.ts`, exactly:

```ts
import { z } from "zod";

const credits = z.number().int().min(0);
const time = z.number().int().min(0);

// GET /v1/wallet. monthly and purchased are what is free to spend now (open holds are already taken
// out of them); held is the total of open holds; available is monthly + purchased; owed is the
// balance owed, which the next credits coming in pay first.
export const WalletResponseSchema = z.strictObject({
  balance: z.strictObject({
    monthly: credits,
    purchased: credits,
    held: credits,
    owed: credits,
    available: credits,
  }),
  monthly_resets_at: time.nullable(),
  plan: z.enum(["free", "plus", "own"]),
  entitlements: z.array(
    z.strictObject({
      product: z.string().min(1),
      source: z.enum(["purchase", "family_share"]),
      media_cap_gb: credits,
      granted_at: time,
      ended_at: time.nullable(),
    }),
  ),
});

export type WalletResponse = z.infer<typeof WalletResponseSchema>;

export const LEDGER_PAGE_DEFAULT = 50;
export const LEDGER_PAGE_MAX = 100;

// GET /v1/wallet/ledger?after=<seq>&limit=<n>. Ask again with after=next until entries is empty.
export const LedgerResponseSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      id: z.string().min(1),
      at: time,
      user_id: z.string().min(1).nullable(),
      kind: z.enum(["grant", "hold", "settle", "release", "refund", "clawback", "reset"]),
      bucket: z.enum(["monthly", "purchased", "owed"]),
      credits: z.number().int(),
      ref: z.string(),
    }),
  ),
  next: time,
  open_holds: z.array(z.string().min(1)),
});

export type LedgerResponse = z.infer<typeof LedgerResponseSchema>;
```

`packages/contracts/src/index.ts`: add `export * from "./wallet.ts";`.

`apps/api/src/wallet/route.ts`, exactly:

```ts
import { LEDGER_PAGE_DEFAULT, LEDGER_PAGE_MAX, type LedgerResponse, type WalletResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";

type EntitlementRow = WalletResponse["entitlements"][number];

// A query value of 1 to 15 digits, or the fallback when it is absent.
function queryInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,15}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  return Number(value);
}

export function walletRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/wallet", async (c) => {
      const user = c.get("user");
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const [view, rows] = await Promise.all([
        wallet.read(),
        c.env.DB.prepare(
          "SELECT product, source, media_cap_gb, granted_at, ended_at FROM entitlements WHERE user_id = ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY granted_at, product, source",
        )
          .bind(user.id, deps.now())
          .all<EntitlementRow>(),
      ]);
      const reply: WalletResponse = {
        balance: {
          monthly: view.monthly,
          purchased: view.purchased,
          held: view.holds.reduce((sum, hold) => sum + hold.credits, 0),
          owed: view.owed,
          available: view.monthly + view.purchased,
        },
        monthly_resets_at: view.monthly_resets_at,
        plan: user.plan,
        entitlements: rows.results,
      };
      return c.json(reply);
    })
    .get("/v1/wallet/ledger", async (c) => {
      const user = c.get("user");
      const after = queryInt(c.req.query("after"), 0);
      const limit = queryInt(c.req.query("limit"), LEDGER_PAGE_DEFAULT);
      if (limit < 1 || limit > LEDGER_PAGE_MAX) throw new ApiFailure("bad_request", "invalid request");
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const [page, view] = await Promise.all([wallet.ledger(after, limit), wallet.read()]);
      const reply: LedgerResponse = {
        entries: page.entries,
        next: page.next,
        open_holds: view.holds.map((hold) => hold.id),
      };
      return c.json(reply);
    });
}
```

Only entitlements that have not ended are returned (`ended_at` null or later than now). `plan` comes from the signed-in user's D1 row (already loaded by the session check).

`src/app.ts`: `import { walletRoutes } from "./wallet/route.ts";` and `app.route("/", walletRoutes(deps));` under the existing routes.

Tests.

`packages/contracts/test/wallet.test.ts`: a full good wallet reply parses; negative `owed`, a `plan` of `"gold"`, an entitlement `source` of `"gift"` and an extra key fail. A good ledger reply parses; a ledger entry with `kind: "spend"` fails; negative entry `credits` pass (ledger rows are signed).

`apps/api/test/wallet-route.test.ts`. `DB` is `createTestDb()` with user `u1` (plan `plus`) inserted; `WALLET` is `{ idFromName: (name: string) => name, get: (id: string) => ({ read: async () => store.read(), ledger: async (after: number, limit: number) => store.ledger(after, limit) }) }` over a real `createWalletStore(createTestStore())` (record the names asked for); `walletRoutes({ now: () => NOW })` in the fresh app. Each bullet is one test:
- Seed: grant 10 monthly, grant 5 purchased, hold 12 (`h1`), clawback 7. `GET /v1/wallet` → 200, passes `WalletResponseSchema`, `balance` equals `{ monthly: 0, purchased: 0, held: 12, owed: 4, available: 0 }`, `monthly_resets_at` null, `plan` `"plus"`; the wallet was looked up by `billing_account_id`.
- `monthly_resets_at` after a `reset` command is that command's `resets_at`.
- Entitlements: rows with `ended_at` null, `NOW + 1000` and `NOW - 1` → only the first two, ordered by `granted_at`, with `media_cap_gb` 3 (the column default); another user's entitlement is not included.
- A new wallet with no rows → all zeros, `entitlements: []`.
- `GET /v1/wallet/ledger?limit=2` on the seeded wallet → 2 entries, `next` 2, `open_holds` `["h1"]`, passes `LedgerResponseSchema`; then `?after=2` gives the following entries; paging to the end gives an empty `entries` and `next` equal to `after`.
- No query → up to 50 entries from the start (seed 60 grants: 50 come back, `next` 50).
- `limit=100` is allowed; `limit=0`, `limit=101`, `limit=1.5`, `limit=`, `after=-1`, `after=x` and `after=1e3` each give 400 `bad_request` "invalid request".
- `open_holds` is empty after the hold is settled.

`test/app.test.ts` (add): through `createApp`, `GET /v1/wallet` with no `Authorization` header gives 401.

Not in this PR: any write to the wallet, per-task costs (PR 32 reads `activity`), buying credits (PR 17).

---

## PR 19 · `POST /webhooks/clerk` and the 25 starter credits

Branch `pr/19-clerk-webhook`. Builds on 07 and 08 (merged). No new dependencies: the signature is checked with Web Crypto. Files: `apps/api/src/webhooks/svix.ts`, `apps/api/src/webhooks/clerk.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/svix.test.ts`, `apps/api/test/clerk-webhook.test.ts`, `apps/api/test/app.test.ts` (new test only).

How Clerk signs webhooks (checked against Svix's "verifying payloads manually" guide and Clerk's own `verifyWebhook`, which reads the three `svix-*` headers and uses the Standard Webhooks scheme): headers `svix-id`, `svix-timestamp` (Unix seconds) and `svix-signature`. The signed content is `<svix-id>.<svix-timestamp>.<raw body>`. The key is the base64 part of the signing secret after `whsec_`, decoded. The signature is HMAC-SHA256, base64. `svix-signature` is a space-separated list such as `v1,<sig> v1,<sig2>`; one matching `v1` signature is enough. Svix's libraries reject timestamps more than 5 minutes off; so does this code.

The signing secret is a Worker secret, never in the repo or in `vars`:

```
wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET
```

For local runs it goes in `apps/api/.dev.vars` (already in `.gitignore`).

`src/env.ts`: add `CLERK_WEBHOOK_SIGNING_SECRET: string;` to `Env`. `wrangler.jsonc` does not change.

`src/webhooks/svix.ts`, exactly:

```ts
// Clerk sends webhooks through Svix (the Standard Webhooks scheme). The signed content is
// "<svix-id>.<svix-timestamp>.<raw body>", signed with HMAC-SHA256 using the base64 part of the
// "whsec_..." secret. svix-signature is a space-separated list of "v1,<base64 signature>".
export const SVIX_TOLERANCE_SECONDS = 300;

export type SvixHeaders = { id: string | undefined; timestamp: string | undefined; signature: string | undefined };

export class WebhookSecretError extends Error {
  constructor() {
    super("webhook signing secret is not a whsec_ secret");
    this.name = "WebhookSecretError";
  }
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

// True only when one v1 signature matches and the timestamp is within 5 minutes of now (Unix ms).
// crypto.subtle.verify compares in constant time. Throws WebhookSecretError for a malformed secret.
export async function verifySvix(secret: string, headers: SvixHeaders, body: string, now: number): Promise<boolean> {
  const keyBytes = typeof secret === "string" && secret.startsWith("whsec_") ? base64Bytes(secret.slice("whsec_".length)) : null;
  if (keyBytes === null || keyBytes.byteLength === 0) throw new WebhookSecretError();

  const { id, timestamp, signature } = headers;
  if (id === undefined || timestamp === undefined || signature === undefined) return false;
  if (id === "" || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const part of signature.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const bytes = base64Bytes(part.slice(3));
    if (bytes === null) continue;
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
  }
  return false;
}
```

`src/webhooks/clerk.ts`, exactly:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { loadOrCreateUser } from "../auth/users.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { verifySvix, WebhookSecretError } from "./svix.ts";

export const STARTER_CREDITS = 25;

const ClerkEventSchema = z.object({
  type: z.string().min(1),
  data: z.object({ id: z.string().min(1).max(128) }),
});

export function clerkWebhookRoute(deps: { now: () => number; newId: () => string }) {
  return new Hono<AppEnv>().post("/webhooks/clerk", async (c) => {
    const body = await c.req.text();
    const now = deps.now();
    let verified: boolean;
    try {
      verified = await verifySvix(
        c.env.CLERK_WEBHOOK_SIGNING_SECRET,
        { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") },
        body,
        now,
      );
    } catch (err) {
      if (err instanceof WebhookSecretError) throw new ApiFailure("internal", "webhook not configured");
      throw err;
    }
    if (!verified) throw new ApiFailure("unauthorized", "invalid signature");

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const parsed = ClerkEventSchema.safeParse(json);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const event = parsed.data;

    if (event.type === "user.created") {
      const user = await loadOrCreateUser(c.env.DB, event.data.id, now, deps.newId);
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      // The command id is the same for every delivery of this user's event, so the wallet grants once.
      await wallet.apply({
        type: "grant",
        id: `starter:${user.id}`,
        bucket: "purchased",
        credits: STARTER_CREDITS,
        ref: "starter",
        user_id: user.id,
      });
    } else if (event.type === "user.deleted") {
      await c.env.DB.prepare("DELETE FROM users WHERE clerk_id = ?").bind(event.data.id).run();
    }
    return c.json({ ok: true });
  });
}
```

What it does and why:
- The raw body is read as text and checked before it is parsed, so any change to the body fails the check.
- `ClerkEventSchema` is a plain `z.object` (not strict): Clerk sends many more fields, and only `type` and `data.id` are read. Nothing else from the payload (email, name, phone) is stored or logged.
- `user.created`: the same `loadOrCreateUser` as the session check, so it does not matter whether the webhook or the person's first signed-in request comes first. The grant goes to the purchased bucket (decision 7). The wallet remembers the command id, so Clerk's retries and a replayed event grant nothing more.
- `user.deleted`: deletes the D1 row; cascades remove the rest (decision 8). A deleted event for a user we never saw changes nothing and still returns 200. The wallet is not touched.
- Every other event type returns 200 and does nothing, so Clerk does not retry it. Subscribe the endpoint to `user.created` and `user.deleted` only.
- Any non-2xx reply makes Clerk retry, which is what we want for a wallet or D1 failure (500).
- The route is under `/webhooks/*`, so the session check and the Idempotency-Key check do not run on it.

`src/app.ts`: `import { clerkWebhookRoute } from "./webhooks/clerk.ts";` and `app.route("/", clerkWebhookRoute(deps));` under the existing routes (`deps` has `now` and `newId`).

Tests.

`test/svix.test.ts`. Sign in the test with Web Crypto:

```ts
async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.slice("whsec_".length)), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}
```

with a test secret `"whsec_" + btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))`. Each bullet is one test:
- Svix's published example verifies: secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, id `msg_p5jXN8AQM9LWM0D4loKWxJek`, timestamp `1614265330`, body `{"test": 2432232314}` (exactly, with the space), signature `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`, `now` `1614265330000` → true.
- The same example with one character of the body changed → false; with another id → false; with another timestamp → false.
- A good signature → true; a signature made with another secret → false.
- A header `v1,<bad> v1,<good>` → true; `v2,<good>` alone → false; `v1,!!!` (not base64) → false, no throw; an empty header → false.
- Timestamp 300 s before or after `now` → true; 301 s → false either way; `"abc"` and `""` → false.
- A missing id, timestamp or signature → false.
- A secret without `whsec_`, `"whsec_"` alone and `"whsec_***"` each throw `WebhookSecretError`.

`test/clerk-webhook.test.ts`. `DB` is `createTestDb()`. `WALLET` is `{ idFromName: (name: string) => name, get: (id: string) => ({ apply: async (command: Command) => walletFor(id).apply(command, NOW) }) }`, where `walletFor` keeps one `createWalletStore(createTestStore())` per name in a `Map`. The route is `clerkWebhookRoute({ now: () => NOW, newId: () => "id-" + ++n })` in a plain `new Hono<AppEnv>()` with `handleError` (no user middleware; webhooks have no session). Every request carries `svix-id`, `svix-timestamp` and a `svix-signature` made with `sign` above, unless the test says otherwise; `env` is `{ DB, WALLET, CLERK_WEBHOOK_SIGNING_SECRET: SECRET }`. Each bullet is one test:
- `user.created` for `user_abc` → 200 `{ ok: true }`; one `users` row with `clerk_id` `user_abc`; its wallet (`walletFor(<billing_account_id>)`) has purchased 25, monthly 0; its ledger has one `grant` entry with `ref` `"starter"`.
- The same event sent twice, and the same payload with a new `svix-id` → still one row and purchased 25.
- The person signed in first (call `loadOrCreateUser(DB, "user_abc", NOW, () => "first")` before the webhook) → the grant goes to wallet `"first"`; no second row.
- Balance owed first: create the user with `loadOrCreateUser(DB, "user_abc", NOW, () => "first")`, apply `{ type: "clawback", id: "c1", credits: 10, ref: "r" }` to `walletFor("first")`, then send `user.created` → owed 0 and purchased 15 (credits coming in pay the balance owed first; this is the ledger's rule, not new code).
- `user.deleted` for a known user → 200; the `users` row is gone, and an `entitlements` row and an `idempotency` row inserted for that user are gone too; the wallet's balance is unchanged.
- `user.deleted` for an unknown Clerk id → 200; nothing changes.
- `session.created` (any other type) → 200; no row, no wallet call.
- Bad signature → 401 `{ code: "unauthorized", message: "invalid signature", retry_after: null }`; no row, no wallet call.
- No `svix-*` headers → 401.
- Timestamp 301 s old (signed correctly) → 401.
- A body changed after signing → 401.
- Signed but not JSON → 400 `bad_request`; signed JSON without `data.id` → 400.
- `CLERK_WEBHOOK_SIGNING_SECRET` missing from `env` or not a `whsec_` secret → 500 `{ code: "internal", message: "webhook not configured", retry_after: null }`.
- Privacy: a `user.created` payload with `data.email_addresses: [{ email_address: "kid@example.com" }]` and `data.first_name: "Sam"` → no `users` column and no wallet ledger field contains `kid@example.com` or `Sam`, and no console method is called.

`test/app.test.ts` (add): through `createApp`, with an env that also has `CLERK_WEBHOOK_SIGNING_SECRET` set to a test `whsec_` secret, `POST /webhooks/clerk` with no `Authorization`, no Idempotency-Key and no `svix-*` headers gives 401 with message `"invalid signature"` (it reached the webhook, not the session check).

Not in this PR: deleting the user's groups, room data, R2 objects or devices' keys beyond the D1 cascade (a later cleanup card), Clerk events other than `user.created` and `user.deleted`, storing any Clerk profile data.

---

## Owner setup before these go live

- **AI Gateway:** create a gateway named `waypoint` in the Cloudflare account (or change `AI_GATEWAY_ID` in `wrangler.jsonc`). Turn its default log collection off too, as a second guard; every call already sends `collectLog: false` and `skipCache: true`. Set per-account rate limits there.
- **Queue:** `wrangler queues create waypoint-usage`. Until PR 33 adds the consumer, events wait in the queue (and expire after its retention period).
- **KV:** `config:router.model` must be the real Clef-flash model id on Workers AI, and every model in `config:routes:<version>` must be a Workers AI id (`@cf/...`).
- **Clerk:** add a webhook endpoint `https://<api host>/webhooks/clerk` subscribed to `user.created` and `user.deleted`, then `wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET` with its signing secret.
