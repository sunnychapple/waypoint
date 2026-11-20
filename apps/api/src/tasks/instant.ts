import { apiError, IDEMPOTENCY_KEY_HEADER, isValidIdempotencyKey, type StreamDone } from "@waypoint/contracts";
import { quoteCredits } from "@waypoint/pricing";
import type { Tier } from "@waypoint/router";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { gatewayOptions, replyText, type AiBinding } from "../ai/gateway.ts";
import { routeTask } from "../ai/router.ts";
import { readModelStream, readUsage, type StreamResult } from "../ai/stream.ts";
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
    if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
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
  await sendUsage(c.env.USAGE_QUEUE, {
    v: 1,
    id: held.holdId,
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
    const work = (async () => {
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
    })();
    keepAlive(c, work);
    await work;
  });
}

// workerd stops a request's remaining work when its client goes away, so an answer whose app dropped the connection
// would never settle or send its usage event (the hold stays open until the wallet's alarm releases it). waitUntil
// keeps the Worker running until `work` ends: the model is read to the end (writes to a closed stream are dropped)
// and the answer is settled like any other. Tests that pass no ExecutionContext simply await `work`.
function keepAlive(c: Context<AppEnv>, work: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // Hono throws when there is no ExecutionContext, which happens only in tests.
  }
}

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
