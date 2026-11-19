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
