import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "@waypoint/api-client";
import type { ExplainRequest, StreamDone } from "@waypoint/contracts";
import { classifyFailure, type CloudFailure } from "../core/cloud/failure.ts";
import { api } from "./api.ts";

// Paid instant tasks (PR 14, 15). Features call these; only src/platform talks to the API client.
export function streamExplain(request: ExplainRequest, key: string, onDelta: (text: string) => void, signal: AbortSignal): Promise<StreamDone> {
  return api.explain(request, { key, onDelta, signal });
}

export function toFailure(error: unknown): CloudFailure {
  if (error instanceof ApiCallError) {
    return classifyFailure({ kind: "api", status: error.status, code: error.code, message: error.message, shortfall: error.shortfall });
  }
  if (error instanceof NetworkError) return classifyFailure({ kind: "network" });
  if (error instanceof NotRegisteredError) return classifyFailure({ kind: "not_registered" });
  if (error instanceof BadReplyError) return classifyFailure({ kind: "bad_reply" });
  return { kind: "failed" };
}
