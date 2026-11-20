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

// A Clef-flash reply for a light-tier, confident answer: an easy question (difficulty value 1, p 0.95),
// no web, science at 0.9, and safe at 0.9.
export const GOOD_CLEF_REPLY = {
  model: "clef-flash",
  answers: {
    difficulty: { type: "score", score: 0.1, probabilities: { "0": 0.9, "1": 0.05, "2": 0.03, "3": 0.01, "4": 0.01 } },
    needs_web: { type: "noul", noul: 0.1 },
    subject: {
      type: "choice",
      choice: "science",
      probabilities: { math: 0.025, science: 0.9, language: 0.025, history: 0.025, other: 0.025 },
    },
    unsafe: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 472, output_tokens: 0 },
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
  // What any other model call returns: the router, and double-check (default GOOD_CLEF_REPLY).
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
      return (options.reply ?? (async () => GOOD_CLEF_REPLY))();
    },
  };
  const USAGE_QUEUE: UsageQueue = {
    send: async (event) => {
      if (options.usageFails === true) throw new Error("queue down");
      events.push(event);
    },
  };
  const CONFIG = { get: async (key: string) => map.get(key) ?? null };
  const env = { CONFIG, WALLET, AI, USAGE_QUEUE, AI_GATEWAY_ID: "gw-test" };
  return { env, store, commands, walletNames, aiCalls, events };
}
