import type { SessionUser } from "./auth/users.ts";
import type { Wallet } from "./wallet/object.ts";

export type Env = {
  DB: D1Database;
  CONFIG: KVNamespace;
  CLERK_ISSUER: string;
  CLERK_AUTHORIZED_PARTIES: string;
  WALLET: DurableObjectNamespace<Wallet>;
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
