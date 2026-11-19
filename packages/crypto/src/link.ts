import { toBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";

// A shared link's passcode is checked by the server, not used as a key (docs/security.md, "Shared links").
// passcode_hash = base64url(HMAC-SHA256(pepper, context("link-passcode", link id, passcode)))
export async function linkPasscodeHash(pepper: Uint8Array, linkId: string, passcode: string): Promise<string> {
  if (pepper.length !== 32) throw new RangeError("bad pepper");
  const key = await crypto.subtle.importKey("raw", pepper, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, context("link-passcode", checkId(linkId), passcode));
  return toBase64Url(new Uint8Array(mac));
}
