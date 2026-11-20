import type { SignedDevice } from "./auth/signature.ts";
import type { SessionUser } from "./auth/users.ts";
import type { JobRunInput } from "./jobs/start.ts";
import type { PushMessage } from "./push/messages.ts";
import type { GroupRoom } from "./room/object.ts";
import type { UsageEvent } from "./usage.ts";
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
  USAGE_QUEUE: Queue<UsageEvent>;
  ANALYTICS: AnalyticsEngineDataset;
  BUCKET: R2Bucket;
  APPLE_BUNDLE_ID: string;
  APPLE_ENVIRONMENTS: string; // comma-separated: Production, Sandbox
  APPLE_APP_APPLE_ID: string; // the app's numeric Apple id from App Store Connect
  WRITE_WORKFLOW: Workflow<JobRunInput>;
  RETRANSCRIBE_WORKFLOW: Workflow<JobRunInput>;
  RESEARCH_WORKFLOW: Workflow<JobRunInput>;
  BROWSER: BrowserRun;
  LINK_PASSCODE_PEPPER: string; // secret: wrangler secret put LINK_PASSCODE_PEPPER (32 random bytes, base64url)
  TURNSTILE_SECRET_KEY: string; // secret: wrangler secret put TURNSTILE_SECRET_KEY
  LINK_VIEWS: RateLimit;
  LINK_PASSCODES: RateLimit;
  ASSETS: Fetcher;
  JOB_STARTS: RateLimit;
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; device: SignedDevice } };
