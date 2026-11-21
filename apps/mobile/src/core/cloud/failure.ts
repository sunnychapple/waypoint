// Why a cloud task did not give an answer, as the screens need it. src/platform/tasks.ts turns API client errors into
// FailureInput; this file decides what it means.
export type FailureInput =
  | { kind: "api"; status: number; code: string; message: string; shortfall: number | null }
  | { kind: "network" }
  | { kind: "not_registered" }
  | { kind: "bad_reply" };

export type CloudFailure =
  | { kind: "out_of_credits"; shortfall: number }
  | { kind: "zero_retention" }
  | { kind: "model_failed" }
  | { kind: "already_finished" }
  | { kind: "busy" }
  | { kind: "offline" }
  | { kind: "device" }
  | { kind: "signed_out" }
  | { kind: "failed" };

export function classifyFailure(input: FailureInput): CloudFailure {
  if (input.kind === "network") return { kind: "offline" };
  if (input.kind === "not_registered") return { kind: "device" };
  if (input.kind === "bad_reply") return { kind: "failed" };
  const { status, code, message } = input;
  if (status === 402 && input.shortfall !== null) return { kind: "out_of_credits", shortfall: input.shortfall };
  if (status === 403 && code === "forbidden") return { kind: "zero_retention" };
  if (status === 401) return message === "device signature required" ? { kind: "device" } : { kind: "signed_out" };
  if (status === 409 && message === "request already finished") return { kind: "already_finished" };
  if (status === 409 || status === 429) return { kind: "busy" };
  if (status === 200 || message === "model unavailable") return { kind: "model_failed" }; // 200: an "error" event in the stream
  return { kind: "failed" };
}

// Whether "Try again" may re-send with the same Idempotency-Key. Out of credits: the hold was never made, so the same
// request runs after a purchase. A failed or finished answer needs a new key (docs/architecture.md section 4).
export function keepsKey(failure: CloudFailure): boolean {
  return failure.kind === "out_of_credits" || failure.kind === "busy" || failure.kind === "offline" || failure.kind === "device" || failure.kind === "signed_out";
}

export type FailureAction = "try_again" | "get_credits" | "ask_later" | "approve_device" | "close";
export type FailureCopy = { title: string; body: string; actions: FailureAction[] };

export function failureCopy(failure: CloudFailure): FailureCopy {
  switch (failure.kind) {
    case "out_of_credits":
      return {
        title: "Out of credits",
        body: `You need ${failure.shortfall} more ${failure.shortfall === 1 ? "credit" : "credits"} for this. Get credits, then try again.`,
        actions: ["get_credits", "try_again"],
      };
    case "zero_retention":
      return {
        title: "Zero retention is on",
        body: "No cloud model that keeps nothing is available yet, so cloud tasks can't run. Turn zero retention off in Settings › Cloud & privacy to use this.",
        actions: ["close"],
      };
    case "model_failed":
      return { title: "Couldn't get an answer", body: "Nothing was charged. You can try again, or keep it as a question for later.", actions: ["try_again", "ask_later"] };
    case "already_finished":
      return { title: "That request already finished", body: "Try again to ask once more.", actions: ["try_again"] };
    case "busy":
      return { title: "Still working on it", body: "Your last request hasn't finished yet. Try again in a moment.", actions: ["try_again"] };
    case "offline":
      return { title: "You're offline", body: "We saved your question — find it in Questions for later.", actions: ["ask_later", "try_again"] };
    case "device":
      return { title: "This iPhone isn't ready", body: "It needs to be set up before it can use credits.", actions: ["approve_device"] };
    case "signed_out":
      return { title: "Sign in again", body: "Your sign-in has ended. Sign in again to use the cloud.", actions: ["close"] };
    case "failed":
      return { title: "Something went wrong", body: "Try again in a moment.", actions: ["try_again"] };
  }
}
