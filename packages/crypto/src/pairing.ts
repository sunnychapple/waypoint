import { fromBase64Url, sha256, toBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { decodePublicKey } from "./keys.ts";

// Adding a device (docs/security.md, "Adding a device"). Keys and nonces are base64url text.
export const PAIRING_NONCE_BYTES = 32;

function checkNonce(nonce: string): string {
  if (fromBase64Url(nonce).length !== PAIRING_NONCE_BYTES) throw new RangeError("bad pairing nonce");
  return nonce;
}

// The new device commits to its nonce before it sees the approver's nonce.
export async function pairingCommitment(signPub: string, boxPub: string, newNonce: string): Promise<string> {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return toBase64Url(await sha256(context("pair-commit", signPub, boxPub, checkNonce(newNonce))));
}

// The 6-digit code both screens show: the first 4 bytes of the hash, big-endian, mod 1,000,000.
export async function pairingCode(input: {
  newSignPub: string;
  newBoxPub: string;
  approverSignPub: string;
  approverNonce: string;
  newNonce: string;
}): Promise<string> {
  decodePublicKey(input.newSignPub);
  decodePublicKey(input.newBoxPub);
  decodePublicKey(input.approverSignPub);
  const digest = await sha256(
    context(
      "pair-code",
      input.newSignPub,
      input.newBoxPub,
      input.approverSignPub,
      checkNonce(input.approverNonce),
      checkNonce(input.newNonce),
    ),
  );
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, "0");
}
