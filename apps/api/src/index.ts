import { topUpYearlyPlus } from "./apple/allowance.ts";
import { createApp } from "./app.ts";
import { cleanup } from "./cleanup.ts";
import type { Env } from "./env.ts";
import { apnsJwtSource } from "./push/apns.ts";
import { handlePushBatch, PUSH_QUEUE_NAME, type PushDeps } from "./push/consumer.ts";
import { handleUsageBatch, USAGE_QUEUE_NAME } from "./usage-consumer.ts";

export { GroupRoom } from "./room/object.ts";
export { Wallet } from "./wallet/object.ts";

const app = createApp({
  fetchJwks: (url) => fetch(url).then((r) => r.json()),
  now: Date.now,
  newId: () => crypto.randomUUID(),
});

const pushDeps: PushDeps = { fetch: (input, init) => fetch(input, init), now: Date.now, jwt: apnsJwtSource(Date.now) };

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    if (batch.queue === PUSH_QUEUE_NAME) return handlePushBatch(batch, env, pushDeps);
    if (batch.queue === USAGE_QUEUE_NAME) return handleUsageBatch(batch, env);
    throw new Error("unknown queue");
  },
  async scheduled(controller, env) {
    await cleanup(env, controller.scheduledTime);
    await topUpYearlyPlus(env.DB, (id) => env.WALLET.get(env.WALLET.idFromName(id)), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
