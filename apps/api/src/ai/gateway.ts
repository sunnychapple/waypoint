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
