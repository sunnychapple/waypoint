import { concat } from "./bytes.ts";
import { context } from "./context.ts";
import { HPKE_ENC_BYTES, hpkeOpen, hpkeSeal } from "./hpke.ts";
import { checkId } from "./ids.ts";

// A task result sealed to the device that asked for it (docs/security.md, "Sealed task results").
//   u8 version (1) | u8 purpose (3) | enc (65) | ct
export const SEALED_VERSION = 1;
export const PURPOSE_RESULT = 3;
export const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const HEADER = new Uint8Array([SEALED_VERSION, PURPOSE_RESULT]);

export function resultInfo(jobId: string, deviceId: string): Uint8Array {
  return context("result", checkId(jobId), checkId(deviceId));
}

export async function sealResult(input: {
  jobId: string;
  deviceId: string;
  deviceBoxPub: Uint8Array;
  plaintext: Uint8Array;
  ekm?: Uint8Array;
}): Promise<Uint8Array> {
  if (input.plaintext.length > MAX_RESULT_BYTES) throw new RangeError("result too large");
  const info = resultInfo(input.jobId, input.deviceId);
  const { enc, ct } = await hpkeSeal(input.deviceBoxPub, info, HEADER, input.plaintext, input.ekm);
  return concat(HEADER, enc, ct);
}

export async function openResult(sealed: Uint8Array, jobId: string, deviceId: string, deviceKey: CryptoKey): Promise<Uint8Array> {
  if (sealed.length < 2 + HPKE_ENC_BYTES + 16 || sealed[0] !== SEALED_VERSION || sealed[1] !== PURPOSE_RESULT) {
    throw new RangeError("bad sealed result");
  }
  const enc = sealed.slice(2, 2 + HPKE_ENC_BYTES);
  return hpkeOpen(deviceKey, enc, resultInfo(jobId, deviceId), HEADER, sealed.slice(2 + HPKE_ENC_BYTES));
}
