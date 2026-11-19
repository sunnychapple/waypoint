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
