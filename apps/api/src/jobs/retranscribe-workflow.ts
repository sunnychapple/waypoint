import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env.ts";
import { jobDeps } from "./job.ts";
import { AUDIO_UPLOADED_EVENT, runRetranscribeJob, type RetranscribeSteps } from "./retranscribe.ts";
import type { JobRunInput } from "./start.ts";

// Thin on purpose: binds env to the deps and hands over to retranscribe.ts. Tests never import this file.
export class RetranscribeWorkflow extends WorkflowEntrypoint<Env, JobRunInput> {
  override async run(event: Readonly<WorkflowEvent<JobRunInput>>, step: WorkflowStep): Promise<void> {
    const env = this.env;
    const input = event.payload;
    const steps: RetranscribeSteps = {
      do: (name, config, fn) => step.do(name, config, fn),
      waitForUpload: async (name, timeoutMs) =>
        (await step.waitForEvent<{ chunks: number; bytes: number }>(name, { type: AUDIO_UPLOADED_EVENT, timeout: timeoutMs })).payload,
    };
    await runRetranscribeJob(
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
