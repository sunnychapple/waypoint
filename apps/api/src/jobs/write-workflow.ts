import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env.ts";
import { jobDeps } from "./job.ts";
import type { Steps } from "./run.ts";
import type { JobRunInput } from "./start.ts";
import { runWriteJob } from "./write.ts";

// Thin on purpose: binds env to the deps and hands over to write.ts. Tests never import this file.
export class WriteWorkflow extends WorkflowEntrypoint<Env, JobRunInput> {
  override async run(event: Readonly<WorkflowEvent<JobRunInput>>, step: WorkflowStep): Promise<void> {
    const env = this.env;
    const input = event.payload;
    const steps: Steps = { do: (name, config, fn) => step.do(name, config, fn) };
    await runWriteJob(
      {
        ...jobDeps(env, input.billing_account_id, Date.now),
        bucket: env.BUCKET,
        ai: env.AI,
        gatewayId: env.AI_GATEWAY_ID,
      },
      steps,
      input,
    );
  }
}
