import { topUpYearlyPlus } from "./apple/allowance.ts";
import type { WalletCommands } from "./apple/purchases.ts";
import { createApp } from "./app.ts";
import { cleanup, type CleanupEnv } from "./cleanup.ts";
import type { Env } from "./env.ts";
import { endExpiredMemberships } from "./groups/expiry.ts";
import { apnsJwtSource } from "./push/apns.ts";
import { handlePushBatch, PUSH_QUEUE_NAME, type PushDeps } from "./push/consumer.ts";
import type { BatchDb } from "./storage.ts";
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
    await runScheduled(env, (id) => env.WALLET.get(env.WALLET.idFromName(id)), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;

// Every job runs even if another fails; a failure is rethrown afterwards so it still shows in the logs.
export async function runScheduled(env: CleanupEnv & { DB: BatchDb }, walletFor: (billingAccountId: string) => WalletCommands, now: number): Promise<void> {
  const results = await Promise.allSettled([cleanup(env, now), topUpYearlyPlus(env.DB, walletFor, now), endExpiredMemberships(env.DB, now)]);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}
