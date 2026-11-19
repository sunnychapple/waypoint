import type { Wallet } from "./wallet/object.ts";

export type Env = { DB: D1Database; CONFIG: KVNamespace; WALLET: DurableObjectNamespace<Wallet> };
export type AppEnv = { Bindings: Env };
