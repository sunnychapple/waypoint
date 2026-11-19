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
