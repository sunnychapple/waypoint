import type { SessionUser } from "./auth/users.ts";
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
  APPLE_BUNDLE_ID: string;
  APPLE_ENVIRONMENTS: string; // comma-separated: Production, Sandbox
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
