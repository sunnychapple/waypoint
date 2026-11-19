import type { SessionUser } from "./auth/users.ts";
import type { PushMessage } from "./push/messages.ts";
import type { GroupRoom } from "./room/object.ts";
import type { Wallet } from "./wallet/object.ts";

export type Env = {
  DB: D1Database;
  CONFIG: KVNamespace;
  CLERK_ISSUER: string;
  CLERK_AUTHORIZED_PARTIES: string;
  CLERK_WEBHOOK_SIGNING_SECRET: string;
  WALLET: DurableObjectNamespace<Wallet>;
  GROUP_ROOM: DurableObjectNamespace<GroupRoom>;
  AI: Ai;
  AI_GATEWAY_ID: string;
  PUSH_QUEUE: Queue<PushMessage>;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_TOPIC: string;
  APNS_PRIVATE_KEY: string; // secret: wrangler secret put APNS_PRIVATE_KEY
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
