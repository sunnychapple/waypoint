import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import { apnsJwtSource } from "./push/apns.ts";
import { handlePushBatch, PUSH_QUEUE_NAME, type PushDeps } from "./push/consumer.ts";

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
    throw new Error("unknown queue");
  },
} satisfies ExportedHandler<Env>;
