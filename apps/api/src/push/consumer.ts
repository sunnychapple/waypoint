import type { QueueBatch } from "../queue.ts";
import type { Db } from "../storage.ts";
import { sendApns, type ApnsConfig, type ApnsDevice, type FetchLike } from "./apns.ts";
import { notificationFor, PushMessageSchema } from "./messages.ts";

export const PUSH_QUEUE_NAME = "waypoint-push";
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
export const PUSH_RETRY_DELAY_SECONDS = 60;
// wrangler.jsonc ships this placeholder until the owner sets the real APNs key id.
export const APNS_KEY_ID_PLACEHOLDER = "XXXXXXXXXX";

export type PushEnv = {
  DB: Db;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_TOPIC: string;
  APNS_PRIVATE_KEY: string;
};

export type PushDeps = { fetch: FetchLike; now: () => number; jwt: (config: ApnsConfig) => Promise<string> };

type TokenRow = ApnsDevice & { device_id: string };

// APNs is set up by the owner. Until its key is in place, a push cannot be sent, and retrying would not change that.
function apnsConfigured(env: PushEnv): boolean {
  return env.APNS_PRIVATE_KEY.trim() !== "" && env.APNS_KEY_ID.trim() !== "" && env.APNS_KEY_ID !== APNS_KEY_ID_PLACEHOLDER;
}

export async function handlePushBatch(batch: QueueBatch, env: PushEnv, deps: PushDeps): Promise<void> {
  const config: ApnsConfig = {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKeyPem: env.APNS_PRIVATE_KEY,
    topic: env.APNS_TOPIC,
  };
  let warnedNotConfigured = false;
  for (const message of batch.messages) {
    const parsed = PushMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack(); // a bad message never gets better; drop it
      continue;
    }
    const push = parsed.data;
    try {
      const query =
        push.device_id === null
          ? env.DB.prepare("SELECT device_id, token, environment FROM push_tokens WHERE user_id = ?").bind(push.user_id)
          : env.DB.prepare("SELECT device_id, token, environment FROM push_tokens WHERE user_id = ? AND device_id = ?").bind(
              push.user_id,
              push.device_id,
            );
      const { results } = await query.all<TokenRow>();
      // Nobody to tell: done, before any APNs key is touched.
      if (results.length === 0) {
        message.ack();
        continue;
      }
      if (!apnsConfigured(env)) {
        // Acked, not retried: a retry cannot succeed until the owner sets APNs, and would only run again for 5 tries.
        if (!warnedNotConfigured) {
          console.warn("push: APNs is not configured (APNS_PRIVATE_KEY or APNS_KEY_ID); dropping pushes for this batch");
          warnedNotConfigured = true;
        }
        message.ack();
        continue;
      }
      const jwt = await deps.jwt(config);
      const notification = notificationFor(push);
      const expiresAt = Math.floor(deps.now() / 1000) + PUSH_TTL_SECONDS;
      let retry = false;
      for (const device of results) {
        const result = await sendApns(deps.fetch, jwt, config, device, notification, expiresAt);
        if (result === "drop_token") {
          await env.DB.prepare("DELETE FROM push_tokens WHERE token = ?").bind(device.token).run();
        }
        if (result === "retry") retry = true;
      }
      if (retry) message.retry({ delaySeconds: PUSH_RETRY_DELAY_SECONDS });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: PUSH_RETRY_DELAY_SECONDS });
    }
  }
}
