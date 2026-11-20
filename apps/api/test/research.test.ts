import { ResearchResultSchema } from "@waypoint/contracts";
import { openResult } from "@waypoint/crypto";
import { describe, expect, test } from "vitest";
import type { AiBinding, GatewayCallOptions } from "../src/ai/gateway.ts";
import type { ConfigKv } from "../src/config/load.ts";
import { ModelError } from "../src/jobs/model.ts";
import {
  findSources,
  isWebUrl,
  mapLimited,
  PAGE_CHARS,
  PLAN_SYSTEM,
  planQueries,
  READ_CONCURRENCY,
  readPage,
  RESEARCH_CAPS,
  READ_SYSTEM,
  runResearchJob,
  WRITE_SYSTEM,
  type PageReader,
  type ResearchDeps,
  type SearchBinding,
} from "../src/jobs/research.ts";
import type { ChatMessage } from "../src/tasks/instant.ts";
import { fakeSteps, JOB_NOW, makeJobFixture } from "./helpers/jobs.ts";
import { configEntries } from "./helpers/tasks.ts";

// Compile-time checks: the Ai, Browser Run and R2 bindings are accepted where the research job expects them.
export const searchFits: (ai: Ai) => SearchBinding = (ai) => ai;
export const pageFits: (browser: BrowserRun) => PageReader = (browser) => browser;
export const bucketFits: (bucket: R2Bucket) => ResearchDeps["bucket"] = (bucket) => bucket;

const LIGHT = "workers-ai/glm-4.7-flash";
const STRONG = "@cf/test/strong";
const SEARCH_ITEMS = [
  { url: "https://a.example/sky", title: "Sky A", description: "About the sky" },
  { url: "https://b.example/light", title: "Light B", description: "About light" },
];

type Reply = (system: string, user: string) => string;
type Call = { model: string; inputs: Record<string, unknown>; options: { gateway: GatewayCallOptions; signal?: AbortSignal } };

function pageUrl(user: string): string {
  return /Page \((.*?)\):/.exec(user)?.[1] ?? "";
}

// Answers by the system prompt it gets: a query plan, notes for a page, or the answer.
function defaultReply(system: string, user: string): string {
  if (system.startsWith("You plan web searches")) return '{"queries":["why is the sky blue","sky colour"]}';
  if (system.startsWith("You read one web page")) return `Notes from ${pageUrl(user)}`;
  return "The sky is blue because of scattering [1].";
}

// A fake Workers AI binding: records each call; a reply that throws makes the call reject.
function fakeAi(reply: Reply = defaultReply) {
  const calls: Call[] = [];
  const ai: AiBinding = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      const messages = inputs.messages as ChatMessage[];
      const content = reply(messages[0]?.content ?? "", messages[1]?.content ?? "");
      return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
    },
  };
  return { ai, calls };
}

type SearchRun = (query: string) => Promise<Response>;
function fakeSearch(run: SearchRun = async () => Response.json({ items: SEARCH_ITEMS })) {
  const calls: { gatewayId: string; query: string; provider: string; limit: number }[] = [];
  const search: SearchBinding = {
    websearch: async (request) => {
      calls.push(request);
      return run(request.query);
    },
  };
  return { search, calls };
}

type PageRun = (url: string) => Promise<Response>;
function fakePage(run: PageRun = async (url) => Response.json({ success: true, result: `Text of ${url}` })) {
  const calls: { action: string; options: Parameters<PageReader["quickAction"]>[1] }[] = [];
  const browser: PageReader = {
    quickAction: async (action, options) => {
      calls.push({ action, options });
      return run(options.url);
    },
  };
  return { browser, calls };
}

function configKv(): ConfigKv {
  const entries = configEntries();
  return { get: async (key) => entries[key] ?? null };
}

// A research job's fixture (standard depth unless told otherwise) with fake bindings and the deps built from them.
async function build(
  fixture: Parameters<typeof makeJobFixture>[1] = {},
  fakes: { reply?: Reply; search?: SearchRun; page?: PageRun } = {},
) {
  const f = await makeJobFixture("research", { credits: 45, depth: "standard", input: { text: "", prompt: "Why is the sky blue?" }, ...fixture });
  const ai = fakeAi(fakes.reply);
  const search = fakeSearch(fakes.search);
  const page = fakePage(fakes.page);
  const deps: ResearchDeps = {
    ...f.deps,
    ai: ai.ai,
    search: search.search,
    browser: page.browser,
    gatewayId: "gw",
    config: configKv(),
    bucket: f.bucket,
  };
  return { f, ai, search, page, deps };
}

const TOKENS = { tokens_in: null, tokens_out: null };

describe("research job", () => {
  test("mapLimited keeps the order of results when later items finish first", async () => {
    const out = await mapLimited([0, 1, 2, 3], 4, async (i) => {
      await new Promise((resolve) => setTimeout(resolve, (4 - i) * 5));
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30]);
  });

  test("mapLimited never has more than 3 calls running at once over 10 items", async () => {
    let running = 0;
    let most = 0;
    await mapLimited(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
    });
    expect(most).toBe(3);
  });

  test("mapLimited over an empty list returns [] without calling fn", async () => {
    let calls = 0;
    const out = await mapLimited([], 3, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  test("planQueries with the quick caps returns [question] and makes no model call; a 500-character question is cut to 400", async () => {
    const { deps, ai } = await build();
    const question = "x".repeat(500);
    expect(await planQueries(deps, LIGHT, question, RESEARCH_CAPS.quick, { ...TOKENS })).toEqual(["x".repeat(400)]);
    expect(ai.calls).toHaveLength(0);
  });

  test("planQueries with the standard caps returns the model's queries trimmed, without duplicates and at most 3", async () => {
    const { deps } = await build({}, { reply: () => '{"queries":[" a ","a","b","c","d"]}' });
    expect(await planQueries(deps, LIGHT, "Q", RESEARCH_CAPS.standard, { ...TOKENS })).toEqual(["a", "b", "c"]);
  });

  test("planQueries falls back to [question] when the reply is not JSON, and when the model call rejects", async () => {
    const notJson = await build({}, { reply: () => "no plan here" });
    expect(await planQueries(notJson.deps, LIGHT, "Why?", RESEARCH_CAPS.standard, { ...TOKENS })).toEqual(["Why?"]);
    const rejects = await build({}, {
      reply: () => {
        throw new Error("model down");
      },
    });
    expect(await planQueries(rejects.deps, LIGHT, "Why?", RESEARCH_CAPS.standard, { ...TOKENS })).toEqual(["Why?"]);
  });

  test("findSources calls websearch per query, drops repeated and non-web URLs, and stops at the page cap", async () => {
    const items: Record<string, { url: string; title: string }[]> = {
      q1: [
        { url: "https://a.example/1", title: "A" },
        { url: "https://b.example/2", title: "B" },
        { url: "ftp://files.example/3", title: "F" },
        { url: "https://c.example/4", title: "C" },
      ],
      q2: [
        { url: "https://b.example/2", title: "B again" },
        { url: "javascript:alert(1)", title: "J" },
        { url: "https://d.example/5", title: "D" },
      ],
    };
    const { deps, search } = await build({}, { search: async (query) => Response.json({ items: items[query] ?? [] }) });
    const sources = await findSources(deps, ["q1", "q2"], RESEARCH_CAPS.quick);
    expect(sources.map((s) => s.url)).toEqual(["https://a.example/1", "https://b.example/2", "https://c.example/4"]);
    expect(search.calls[0]).toEqual({ gatewayId: "gw", query: "q1", provider: "ceramic", limit: 5 });
    expect(search.calls[1]).toEqual({ gatewayId: "gw", query: "q2", provider: "ceramic", limit: 5 });
  });

  test("findSources skips a search that rejects, one that returns status 500 and one with no items, and uses the others", async () => {
    const run = async (query: string): Promise<Response> => {
      if (query === "q1") throw new Error("search down");
      if (query === "q2") return new Response("boom", { status: 500 });
      if (query === "q3") return Response.json({});
      return Response.json({ items: [{ url: "https://e.example/6", title: "E" }] });
    };
    const { deps } = await build({}, { search: run });
    const sources = await findSources(deps, ["q1", "q2", "q3", "q4"], RESEARCH_CAPS.standard);
    expect(sources.map((s) => s.url)).toEqual(["https://e.example/6"]);
  });

  test("findSources throws ModelError when every search fails", async () => {
    const { deps } = await build({}, {
      search: async () => {
        throw new Error("search down");
      },
    });
    await expect(findSources(deps, ["q1", "q2"], RESEARCH_CAPS.standard)).rejects.toThrow(ModelError);
  });

  test("readPage calls quickAction with the reader options and sends the model at most 12,000 characters of a 20,000-character page", async () => {
    const { deps, page, ai } = await build({}, { page: async () => Response.json({ success: true, result: "p".repeat(20_000) }) });
    const source = { url: "https://a.example/sky", title: "Sky A", description: null };
    expect(await readPage(deps, LIGHT, "Q", source, { ...TOKENS })).toBe("Notes from https://a.example/sky");
    expect(page.calls[0]).toEqual({
      action: "markdown",
      options: {
        url: "https://a.example/sky",
        rejectResourceTypes: ["image", "media", "font", "stylesheet"],
        gotoOptions: { timeout: 20000, waitUntil: "domcontentloaded" },
        cacheTTL: 0,
      },
    });
    const content = (ai.calls[0]?.inputs.messages as ChatMessage[])[1]?.content ?? "";
    expect(content.endsWith("p".repeat(PAGE_CHARS))).toBe(true);
    expect(content.includes("p".repeat(PAGE_CHARS + 1))).toBe(false);
  });

  test("readPage returns null when the reply is NONE, when Browser Run returns status 422, when it returns success false, and when the model call rejects", async () => {
    const source = { url: "https://a.example/sky", title: "Sky A", description: null };
    const none = await build({}, { reply: () => "NONE" });
    expect(await readPage(none.deps, LIGHT, "Q", source, { ...TOKENS })).toBeNull();
    const status422 = await build({}, { page: async () => new Response("", { status: 422 }) });
    expect(await readPage(status422.deps, LIGHT, "Q", source, { ...TOKENS })).toBeNull();
    const failed = await build({}, { page: async () => Response.json({ success: false, errors: [] }) });
    expect(await readPage(failed.deps, LIGHT, "Q", source, { ...TOKENS })).toBeNull();
    const rejects = await build({}, {
      reply: () => {
        throw new Error("model down");
      },
    });
    expect(await readPage(rejects.deps, LIGHT, "Q", source, { ...TOKENS })).toBeNull();
  });

  test("readPage cuts notes to 2,000 characters", async () => {
    const { deps } = await build({}, { reply: () => "n".repeat(3_000) });
    const source = { url: "https://a.example/sky", title: "Sky A", description: null };
    const notes = await readPage(deps, LIGHT, "Q", source, { ...TOKENS });
    expect(notes?.length).toBe(2_000);
  });

  test("happy path (standard): the sealed result opens to a cited answer, the models and caps are right, the job is settled at the quote and the input is gone", async () => {
    // The light model finds nothing on the second page, so only the first page is source 1.
    const reply: Reply = (system, user) =>
      system.startsWith("You read one web page") && pageUrl(user).includes("/light") ? "NONE" : defaultReply(system, user);
    const { f, ai, search, deps } = await build({}, { reply });
    expect(await runResearchJob(deps, fakeSteps().steps, f.input)).toBe(true);

    const stored = f.objects.get("results/job_1");
    const opened = await openResult(stored?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    const parsed = ResearchResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)));
    expect(parsed).toEqual({
      v: 1,
      answer: "The sky is blue because of scattering [1].",
      sources: [{ n: 1, url: "https://a.example/sky", title: "Sky A" }],
    });

    expect(search.calls).toHaveLength(2);
    expect(search.calls[0]).toMatchObject({ provider: "ceramic", limit: 5 });
    const writer = ai.calls[ai.calls.length - 1];
    expect(writer?.model).toBe(STRONG);
    expect(writer?.inputs.max_tokens).toBe(1500);
    expect((writer?.inputs.messages as ChatMessage[])[0]?.content).toBe(WRITE_SYSTEM);
    for (const call of ai.calls.slice(0, -1)) expect(call.model).toBe(LIGHT);
    expect((ai.calls[1]?.inputs.messages as ChatMessage[])[0]?.content).toBe(READ_SYSTEM);

    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 45, result_key: "results/job_1" });
    expect(f.objects.has("tmp/input/job_1")).toBe(false);
    // Four model calls (plan, two reads, write), 10 in and 20 out each.
    expect(f.usage).toHaveLength(1);
    expect(f.usage[0]).toMatchObject({ outcome: "ok", credits: 45, task: "research", tier: "strong", model: STRONG, tokens_in: 40, tokens_out: 80 });
  });

  test("the writer's user message has the student's notes for context only when there are notes", async () => {
    const withNotes = await build({ input: { text: "My notes", prompt: "Why is the sky blue?" } });
    expect(await runResearchJob(withNotes.deps, fakeSteps().steps, withNotes.f.input)).toBe(true);
    const writerWith = withNotes.ai.calls[withNotes.ai.calls.length - 1]?.inputs.messages as ChatMessage[];
    expect(writerWith[1]?.content).toContain("The student's own notes, for context:");

    const without = await build({ input: { text: "", prompt: "Why is the sky blue?" } });
    expect(await runResearchJob(without.deps, fakeSteps().steps, without.f.input)).toBe(true);
    const writerWithout = without.ai.calls[without.ai.calls.length - 1]?.inputs.messages as ChatMessage[];
    expect(writerWithout[1]?.content).not.toContain("The student's own notes, for context:");
  });

  test("no page readable: the answer is written from the search descriptions; with no descriptions either, the job fails and the hold is released", async () => {
    const failPage: PageRun = async () => {
      throw new Error("browser down");
    };
    const described = await build({}, { page: failPage });
    expect(await runResearchJob(described.deps, fakeSteps().steps, described.f.input)).toBe(true);
    const writer = described.ai.calls[described.ai.calls.length - 1]?.inputs.messages as ChatMessage[];
    expect(writer[1]?.content).toContain("About the sky");
    const stored = described.f.objects.get("results/job_1");
    const opened = await openResult(stored?.value ?? new Uint8Array(), "job_1", "device_1", described.f.device.boxPrivate);
    expect(ResearchResultSchema.parse(JSON.parse(new TextDecoder().decode(opened))).sources).toHaveLength(2);

    const bare = await build({}, {
      page: failPage,
      search: async () => Response.json({ items: [{ url: "https://a.example/sky", title: "Sky A" }] }),
    });
    expect(await runResearchJob(bare.deps, fakeSteps().steps, bare.f.input)).toBe(false);
    expect(bare.f.store.read().monthly).toBe(100);
    expect(bare.f.objects.has("results/job_1")).toBe(false);
  });

  test("depth deep asks the planner for 6 queries, reads at most 20 pages and settles the deep price, 125", async () => {
    const { f, ai, page, deps } = await build(
      { credits: 40, depth: "deep", input: { text: "", prompt: "Why is the sky blue?" } },
      {
        reply: (system, user) =>
          system.startsWith("You plan web searches") ? '{"queries":["q1","q2","q3","q4","q5","q6","q7"]}' : defaultReply(system, user),
        search: async (query) => Response.json({ items: Array.from({ length: 8 }, (_, i) => ({ url: `https://${query}.example/${i}`, title: `T ${i}` })) }),
      },
    );
    // The fixture holds 40 of its 100 monthly credits; grant 100 more and hold the deep price under a second id.
    f.store.apply({ type: "grant", id: "more", bucket: "monthly", credits: 100, ref: "test" }, JOB_NOW);
    f.store.apply({ type: "hold", id: "job:u1:deep", hold_id: "job:u1:deep", user_id: "u1", task: "research", credits: 125, expires_at: JOB_NOW + 3_600_000 }, JOB_NOW);
    expect(await runResearchJob(deps, fakeSteps().steps, { ...f.input, credits: 125, hold_id: "job:u1:deep" })).toBe(true);
    expect((ai.calls[0]?.inputs.messages as ChatMessage[])[0]?.content).toBe(PLAN_SYSTEM.replace("{n}", "6"));
    expect(page.calls).toHaveLength(20);
    expect(ai.calls[ai.calls.length - 1]?.inputs.max_tokens).toBe(3000);
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 125 });
  });

  test("a zero-retention user: no search, no model call, the job fails and the hold is released", async () => {
    const { f, ai, search, deps } = await build();
    const input = { ...f.input, zero_retention: true };
    expect(await runResearchJob(deps, fakeSteps().steps, input)).toBe(false);
    expect(search.calls).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
    expect(f.store.read().monthly).toBe(100);
  });

  test("prompt null in the stored input: no search, the job fails", async () => {
    const { f, ai, search, deps } = await build({ input: { text: "My notes", prompt: null } });
    expect(await runResearchJob(deps, fakeSteps().steps, f.input)).toBe(false);
    expect(search.calls).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
  });

  test("RESEARCH_CAPS is exactly the table in the card", () => {
    expect(RESEARCH_CAPS).toEqual({
      quick: { queries: 1, results: 5, pages: 3, writeTokens: 800 },
      standard: { queries: 3, results: 5, pages: 8, writeTokens: 1_500 },
      deep: { queries: 6, results: 8, pages: 20, writeTokens: 3_000 },
    });
  });

  test("isWebUrl takes public http and https pages and refuses credentials, IP addresses, localhost and local-only names", () => {
    for (const url of ["https://a.example/sky", "http://b.example.org/x?y=1", "https://Sub.Example.COM./"]) expect(isWebUrl(url), url).toBe(true);
    for (const url of [
      "ftp://a.example/",
      "https://user:pw@a.example/",
      "https://user@a.example/",
      "http://localhost:8080/admin",
      "http://localhost./",
      "http://intranet/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/",
      "http://0x7f.1/",
      "http://2130706433/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://printer.local/",
      "http://db.internal/",
      "http://app.localhost/",
      "http://nas.home.arpa/",
      "not a url",
    ]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });

  test("findSources leaves out search results that are not public web pages", async () => {
    const { deps } = await build({}, {
      search: async () =>
        Response.json({ items: [{ url: "http://169.254.169.254/latest/meta-data", title: "Meta" }, { url: "https://a.example/sky", title: "Sky A" }] }),
    });
    const sources = await findSources(deps, ["sky"], RESEARCH_CAPS.standard);
    expect(sources.map((s) => s.url)).toEqual(["https://a.example/sky"]);
  });

  test("a run reads at most READ_CONCURRENCY (3) pages at a time", async () => {
    let open = 0;
    let peak = 0;
    const { f, deps } = await build({}, {
      search: async (query) => Response.json({ items: Array.from({ length: 8 }, (_, i) => ({ url: `https://${query.length}.example/${i}`, title: `T ${i}` })) }),
      page: async (url) => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open -= 1;
        return Response.json({ success: true, result: `Text of ${url}` });
      },
    });
    expect(await runResearchJob(deps, fakeSteps().steps, f.input)).toBe(true);
    expect(READ_CONCURRENCY).toBe(3);
    expect(peak).toBe(3);
  });
});
