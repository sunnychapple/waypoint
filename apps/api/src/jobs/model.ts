import { gatewayOptions, replyText, type AiBinding } from "../ai/gateway.ts";
import { readUsage } from "../ai/stream.ts";
import type { ChatMessage } from "../tasks/instant.ts";

export type Tokens = { tokens_in: number | null; tokens_out: number | null };

// A model call failed, timed out, or gave no usable answer. Carries no prompt or reply text, because a
// Workflow stores the errors its steps throw.
export class ModelError extends Error {
  constructor() {
    super("model failed");
    this.name = "ModelError";
  }
}

function add(total: number | null, more: number | null): number | null {
  if (more === null) return total;
  return (total ?? 0) + more;
}

// One chat call, not streamed, through AI Gateway with logging and caching off. Adds the call's token counts to
// tokens. Returns the reply text; throws ModelError if the call fails or the reply has no text.
export async function callModel(
  ai: AiBinding,
  gatewayId: string,
  call: { model: string; messages: ChatMessage[]; maxTokens: number; timeoutMs: number },
  tokens: Tokens,
): Promise<string> {
  let output: unknown;
  try {
    output = await ai.run(
      call.model,
      { messages: call.messages, max_tokens: call.maxTokens, chat_template_kwargs: { enable_thinking: false } },
      { gateway: gatewayOptions(gatewayId), signal: AbortSignal.timeout(call.timeoutMs) },
    );
  } catch {
    throw new ModelError();
  }
  const used: Tokens = { tokens_in: null, tokens_out: null };
  readUsage(output, used);
  tokens.tokens_in = add(tokens.tokens_in, used.tokens_in);
  tokens.tokens_out = add(tokens.tokens_out, used.tokens_out);
  const text = replyText(output);
  if (text === null || text.trim() === "") throw new ModelError();
  return text;
}

// The JSON value from the first "{" to the last "}" of a reply, or null if there is none or it does not parse.
export function jsonObjectIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
