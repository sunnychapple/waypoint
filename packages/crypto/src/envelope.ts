import { concat, u16, utf8 } from "./bytes.ts";
import { context } from "./context.ts";
import { HPKE_ENC_BYTES, hpkeOpen, hpkeSeal } from "./hpke.ts";
import { checkId } from "./ids.ts";
import { P256_SIGNATURE_BYTES } from "./keys.ts";

// A key wrapped for one device and signed by the device that wrapped it (docs/security.md, "Envelopes").
//   u8 version (1) | u8 purpose | enc (65) | u16 ct length | ct | u8 signer length | signer id | signature (64)
export const ENVELOPE_VERSION = 1;
export const PURPOSE_GROUP_KEY = 1;
export const PURPOSE_ACCOUNT_KEY = 2;
export type EnvelopePurpose = typeof PURPOSE_GROUP_KEY | typeof PURPOSE_ACCOUNT_KEY;

// Plaintext sizes: a group key is 32 bytes; the account key is the signing scalar then the box scalar.
export const KEY_BYTES: Record<EnvelopePurpose, number> = { 1: 32, 2: 64 };
const TAG_BYTES = 16;

export type ParsedEnvelope = {
  purpose: EnvelopePurpose;
  enc: Uint8Array;
  ct: Uint8Array;
  signerId: string;
  signature: Uint8Array;
  body: Uint8Array; // every byte before the signature
};

export function groupKeyInfo(groupId: string, keyVersion: number, deviceId: string): Uint8Array {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new RangeError("bad key version");
  return context("group-key", checkId(groupId), String(keyVersion), checkId(deviceId));
}

export function accountKeyInfo(userId: string, accountDeviceId: string, deviceId: string): Uint8Array {
  return context("account-key", checkId(userId), checkId(accountDeviceId), checkId(deviceId));
}

// The bytes the wrapping device signs: the HPKE info (which names the group or account and the recipient),
// then the envelope body.
export function envelopeSignatureInput(info: Uint8Array, body: Uint8Array): Uint8Array {
  return concat(context("envelope-sig"), u16(info.length), info, body);
}

export function parseEnvelope(bytes: Uint8Array): ParsedEnvelope {
  const fail = (): never => {
    throw new RangeError("bad envelope");
  };
  if (bytes.length < 2 + HPKE_ENC_BYTES + 2) fail();
  const purpose = bytes[1];
  if (bytes[0] !== ENVELOPE_VERSION || (purpose !== PURPOSE_GROUP_KEY && purpose !== PURPOSE_ACCOUNT_KEY)) fail();
  const p = purpose as EnvelopePurpose;
  let at = 2;
  const enc = bytes.slice(at, at + HPKE_ENC_BYTES);
  at += HPKE_ENC_BYTES;
  const ctLength = ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
  at += 2;
  if (enc[0] !== 0x04 || ctLength !== KEY_BYTES[p] + TAG_BYTES) fail();
  const ct = bytes.slice(at, at + ctLength);
  at += ctLength;
  const signerLength = bytes[at] ?? 0;
  at += 1;
  if (bytes.length !== at + signerLength + P256_SIGNATURE_BYTES) fail();
  const signerId = new TextDecoder().decode(bytes.slice(at, at + signerLength));
  at += signerLength;
  try {
    checkId(signerId);
  } catch {
    fail();
  }
  return { purpose: p, enc, ct, signerId, signature: bytes.slice(at), body: bytes.slice(0, at) };
}

// Reference for the devices and for test vectors. The server only parses envelopes; it never makes or opens them.
export async function makeEnvelope(input: {
  purpose: EnvelopePurpose;
  info: Uint8Array;
  recipientBoxPub: Uint8Array;
  key: Uint8Array;
  signerId: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  ekm?: Uint8Array;
}): Promise<Uint8Array> {
  if (input.key.length !== KEY_BYTES[input.purpose]) throw new RangeError("bad key length");
  const header = new Uint8Array([ENVELOPE_VERSION, input.purpose]);
  const { enc, ct } = await hpkeSeal(input.recipientBoxPub, input.info, header, input.key, input.ekm);
  const signer = utf8(checkId(input.signerId));
  const body = concat(header, enc, u16(ct.length), ct, new Uint8Array([signer.length]), signer);
  const signature = await input.sign(envelopeSignatureInput(input.info, body));
  if (signature.length !== P256_SIGNATURE_BYTES) throw new RangeError("bad signature length");
  return concat(body, signature);
}

export async function openEnvelope(envelope: ParsedEnvelope, info: Uint8Array, recipientKey: CryptoKey): Promise<Uint8Array> {
  const header = new Uint8Array([ENVELOPE_VERSION, envelope.purpose]);
  return hpkeOpen(recipientKey, envelope.enc, info, header, envelope.ct);
}
