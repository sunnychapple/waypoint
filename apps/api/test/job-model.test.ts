import { describe, expect, test } from "vitest";
import type { AiBinding, GatewayCallOptions } from "../src/ai/gateway.ts";
import { callModel, jsonObjectIn, ModelError, type Tokens } from "../src/jobs/model.ts";
import type { ChatMessage } from "../src/tasks/instant.ts";

// A fake Workers AI binding: records each call and answers with the reply it was given (or rejects with an error).
function fakeAi(reply: unknown, rejectWith?: Error) {
  const calls: { model: string; inputs: Record<string, unknown>; options: { gateway: GatewayCallOptions; signal?: AbortSignal } }[] =
    [];
  const ai: AiBinding = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      if (rejectWith !== undefined) throw rejectWith;
      return reply;
    },
  };
  return { ai, calls };
}

const messages: ChatMessage[] = [
  { role: "system", content: "Write a script." },
  { role: "user", content: "Osmosis moves water across a membrane." },
];
const call = { model: "@cf/test/strong", messages, maxTokens: 512, timeoutMs: 30_000 };
const fresh = (): Tokens => ({ tokens_in: null, tokens_out: null });

describe("callModel", () => {
  test("sends the model id, messages, token cap, thinking off, gateway options and a signal, and returns the reply text", async () => {
    const { ai, calls } = fakeAi({ choices: [{ message: { content: "Hello there" } }] });
    const text = await callModel(ai, "gw_test", call, fresh());
    expect(text).toBe("Hello there");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/test/strong");
    expect(calls[0]?.inputs).toEqual({ messages, max_tokens: 512, chat_template_kwargs: { enable_thinking: false } });
    expect(calls[0]?.options.gateway).toEqual({ id: "gw_test", collectLog: false, skipCache: true });
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  test("returns the text of a { response } reply", async () => {
    const { ai } = fakeAi({ response: "From the older shape" });
    expect(await callModel(ai, "gw_test", call, fresh())).toBe("From the older shape");
  });

  test("adds the usage counts to Tokens that start at null, and to Tokens that already hold numbers (5 + 7 = 12)", async () => {
    const reply = { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 7 } };
    const { ai } = fakeAi(reply);
    const fromNull = fresh();
    await callModel(ai, "gw_test", call, fromNull);
    expect(fromNull).toEqual({ tokens_in: 5, tokens_out: 7 });

    const counted: Tokens = { tokens_in: 5, tokens_out: 7 };
    await callModel(ai, "gw_test", call, counted);
    expect(counted).toEqual({ tokens_in: 10, tokens_out: 14 });
  });

  test("leaves Tokens unchanged when the reply has no usage", async () => {
    const { ai } = fakeAi({ choices: [{ message: { content: "ok" } }] });
    const tokens: Tokens = { tokens_in: 3, tokens_out: 4 };
    await callModel(ai, "gw_test", call, tokens);
    expect(tokens).toEqual({ tokens_in: 3, tokens_out: 4 });
  });

  test("throws ModelError whose message holds no prompt text when ai.run rejects", async () => {
    const { ai } = fakeAi(null, new Error("upstream said: Osmosis moves water across a membrane."));
    const error = await callModel(ai, "gw_test", call, fresh()).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ModelError);
    expect((error as Error).message).toBe("model failed");
    expect((error as Error).message).not.toContain("Osmosis");
  });

  test("throws ModelError for a blank reply, for a reply with no choices, and for a non-object reply", async () => {
    for (const reply of ["  ", { choices: [] }, 42]) {
      const { ai } = fakeAi(reply);
      await expect(callModel(ai, "gw_test", call, fresh())).rejects.toBeInstanceOf(ModelError);
    }
  });
});

describe("jsonObjectIn", () => {
  test("returns the object inside a fenced reply", () => {
    expect(jsonObjectIn('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("returns null for text with no braces, and for braces around text that does not parse", () => {
    expect(jsonObjectIn("no braces here")).toBeNull();
    expect(jsonObjectIn("{not json}")).toBeNull();
  });
});
