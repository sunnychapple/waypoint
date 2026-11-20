import { ApiErrorSchema, InsufficientCreditsErrorSchema, type ErrorCode } from "@waypoint/contracts";

// The server answered with the one error shape (docs/architecture.md section 4). status is the HTTP status, or 200
// when a streamed answer ended with an "error" event.
export class ApiCallError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryAfter: number | null;
  readonly shortfall: number | null; // set only for 402 insufficient_credits

  constructor(status: number, code: ErrorCode, message: string, retryAfter: number | null, shortfall: number | null = null) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.shortfall = shortfall;
  }
}

// No reply at all (offline, timed out, connection dropped), or a stream that ended before "done" or "error".
export class NetworkError extends Error {
  constructor(message = "network error") {
    super(message);
    this.name = "NetworkError";
  }
}

// A reply that does not match the contract.
export class BadReplyError extends Error {
  constructor(message = "unexpected reply") {
    super(message);
    this.name = "BadReplyError";
  }
}

// A signed call was made before this device was registered (or while it waits for approval).
export class NotRegisteredError extends Error {
  constructor() {
    super("this device is not registered");
    this.name = "NotRegisteredError";
  }
}

// Turns any error reply into an ApiCallError. A body that is not the error shape becomes "internal".
export function errorFromBody(status: number, body: unknown): ApiCallError {
  const short = InsufficientCreditsErrorSchema.safeParse(body);
  if (status === 402 && short.success) {
    return new ApiCallError(status, short.data.code, short.data.message, short.data.retry_after, short.data.shortfall);
  }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new ApiCallError(status, parsed.data.code, parsed.data.message, parsed.data.retry_after);
  return new ApiCallError(status, "internal", "something went wrong", null);
}
