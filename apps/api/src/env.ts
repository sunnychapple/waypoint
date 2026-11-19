import type { SessionUser } from "./auth/users.ts";

export type Env = {
  DB: D1Database;
  CONFIG: KVNamespace;
  CLERK_ISSUER: string;
  CLERK_AUTHORIZED_PARTIES: string;
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
