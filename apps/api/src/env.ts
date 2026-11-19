import type { GroupRoom } from "./room/object.ts";

export type Env = { DB: D1Database; CONFIG: KVNamespace; GROUP_ROOM: DurableObjectNamespace<GroupRoom> };
export type AppEnv = { Bindings: Env };
