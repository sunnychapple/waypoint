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
