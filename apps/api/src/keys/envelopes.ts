import { fromBase64Url, parseEnvelope, type EnvelopePurpose } from "@waypoint/crypto";
import { ApiFailure } from "../errors.ts";

// The server only checks an envelope's shape and that the device that signed the request wrapped it.
// Recipients verify the signature and the signer's certificate (docs/security.md, section 9).
export function checkEnvelope(wrappedKey: string, purpose: EnvelopePurpose, signerId: string): void {
  let ok = false;
  try {
    const parsed = parseEnvelope(fromBase64Url(wrappedKey));
    ok = parsed.purpose === purpose && parsed.signerId === signerId;
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiFailure("bad_request", "invalid envelope");
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
