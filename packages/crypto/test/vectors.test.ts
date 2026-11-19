import { describe, expect, it } from "vitest";
import {
  accountKeyInfo, bodySha256, concat, context, deviceCertificateInput, envelopeSignatureInput, fromBase64Url, fromHex,
  groupKeyInfo, HPKE_SUITE, importContentKey, linkPasscodeHash, lockContent, makeEnvelope, openEnvelope, openResult,
  pairingCode, pairingCommitment, parseEnvelope, recoveryAad, recoveryWrapKey, requestSigningInput, resultInfo, sealResult,
  toBase64Url, toHex, unlockContent, unwrapAccountKey, utf8, verifyP256, wrapAccountKey, type EnvelopePurpose,
} from "../src/index.ts";
import { readVectors } from "./helpers/vectors.ts";

// test/vectors/waypoint-v1.json is published for the iOS crypto module: the Swift code must produce and accept the
// same bytes. Signatures are random, so for them the vectors give one valid signature to verify.
type Vectors = {
  context: { label: string; fields: string[]; bytes: string };
  request: { method: string; target: string; deviceId: string; timestamp: number; nonce: string; bodySha256: string; body_utf8: string; signing_input: string; device_sign_pub: string; signature: string };
  pairing: { new_sign_pub: string; new_box_pub: string; new_nonce: string; approver_sign_pub: string; approver_nonce: string; commitment: string; code: string };
  device_certificate: { user_id: string; device_id: string; sign_pub: string; box_pub: string; signing_input: string; account_sign_pub: string; signature: string };
  group_key_envelope: { group_id: string; key_version: number; recipient_device_id: string; recipient_private_key: string; recipient_box_pub: string; ikm_e: string; group_key: string; signer_id: string; signer_sign_pub: string; info: string; signature_input: string; envelope: string };
  account_key_envelope: { user_id: string; account_device_id: string; recipient_device_id: string; recipient_private_key: string; ikm_e: string; account_key: string; signer_id: string; signer_sign_pub: string; info: string; envelope: string };
  sealed_result: { job_id: string; device_id: string; device_private_key: string; device_box_pub: string; ikm_e: string; info: string; plaintext_utf8: string; sealed: string };
  recovery: { entropy: string; user_id: string; account_device_id: string; wrap_key: string; aad: string; account_key: string; nonce: string; blob: string };
  content: { key: string; key_version: number; context_label: string; context_fields: string[]; context: string; nonce: string; plaintext_utf8: string; locked: string };
  link_passcode: { pepper: string; link_id: string; passcode: string; hash: string };
};
const v = readVectors<Vectors>("waypoint-v1.json");

const privateKey = async (hex: string): Promise<CryptoKey> => HPKE_SUITE.kem.deserializePrivateKey(fromHex(hex));

describe("waypoint-v1 vectors", () => {
  it("context", () => {
    expect(toHex(context(v.context.label, ...v.context.fields))).toBe(v.context.bytes);
  });

  it("request signing input and signature", async () => {
    const r = v.request;
    expect(await bodySha256(utf8(r.body_utf8))).toBe(r.bodySha256);
    const input = requestSigningInput(r);
    expect(toHex(input)).toBe(r.signing_input);
    expect(await verifyP256(fromBase64Url(r.device_sign_pub), fromBase64Url(r.signature), input)).toBe(true);
    expect(await verifyP256(fromBase64Url(r.device_sign_pub), fromBase64Url(r.signature), requestSigningInput({ ...r, timestamp: r.timestamp + 1 }))).toBe(false);
  });

  it("pairing commitment and code", async () => {
    const p = v.pairing;
    expect(await pairingCommitment(p.new_sign_pub, p.new_box_pub, p.new_nonce)).toBe(p.commitment);
    const input = { newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.approver_nonce, newNonce: p.new_nonce };
    expect(await pairingCode(input)).toBe(p.code);
    expect(await pairingCode({ ...input, approverNonce: p.new_nonce, newNonce: p.approver_nonce })).not.toBe(p.code);
  });

  it("device certificate", async () => {
    const c = v.device_certificate;
    const input = deviceCertificateInput(c.user_id, c.device_id, c.sign_pub, c.box_pub);
    expect(toHex(input)).toBe(c.signing_input);
    expect(await verifyP256(fromBase64Url(c.account_sign_pub), fromBase64Url(c.signature), input)).toBe(true);
  });

  const envelopes: [string, EnvelopePurpose, () => Uint8Array, string, string, string, string, string, string][] = [
    ["group key", 1, () => groupKeyInfo(v.group_key_envelope.group_id, v.group_key_envelope.key_version, v.group_key_envelope.recipient_device_id),
      v.group_key_envelope.info, v.group_key_envelope.envelope, v.group_key_envelope.group_key, v.group_key_envelope.ikm_e, v.group_key_envelope.recipient_private_key, v.group_key_envelope.signer_sign_pub],
    ["account key", 2, () => accountKeyInfo(v.account_key_envelope.user_id, v.account_key_envelope.account_device_id, v.account_key_envelope.recipient_device_id),
      v.account_key_envelope.info, v.account_key_envelope.envelope, v.account_key_envelope.account_key, v.account_key_envelope.ikm_e, v.account_key_envelope.recipient_private_key, v.account_key_envelope.signer_sign_pub],
  ];
  for (const [name, purpose, info, infoHex, envelopeB64, keyHex, ikmE, skHex, signerPub] of envelopes) {
    it(`${name} envelope: same bytes, valid signature, opens`, async () => {
      expect(toHex(info())).toBe(infoHex);
      const expected = fromBase64Url(envelopeB64);
      const parsed = parseEnvelope(expected);
      expect(parsed.purpose).toBe(purpose);
      expect(parsed.signerId).toBe("dev_phone");
      const remade = await makeEnvelope({
        purpose, info: info(), recipientBoxPub: fromBase64Url(v.pairing.new_box_pub), key: fromHex(keyHex), signerId: parsed.signerId,
        sign: async () => parsed.signature, ekm: fromHex(ikmE),
      });
      expect(toBase64Url(remade)).toBe(envelopeB64);
      expect(await verifyP256(fromBase64Url(signerPub), parsed.signature, envelopeSignatureInput(info(), parsed.body))).toBe(true);
      expect(toHex(await openEnvelope(parsed, info(), await privateKey(skHex)))).toBe(keyHex);
    });
  }

  it("group key envelope signature input", () => {
    const g = v.group_key_envelope;
    const parsed = parseEnvelope(fromBase64Url(g.envelope));
    expect(toHex(envelopeSignatureInput(fromHex(g.info), parsed.body))).toBe(g.signature_input);
  });

  it("sealed result: same bytes and opens", async () => {
    const s = v.sealed_result;
    expect(toHex(resultInfo(s.job_id, s.device_id))).toBe(s.info);
    const sealed = await sealResult({ jobId: s.job_id, deviceId: s.device_id, deviceBoxPub: fromBase64Url(s.device_box_pub), plaintext: utf8(s.plaintext_utf8), ekm: fromHex(s.ikm_e) });
    expect(toBase64Url(sealed)).toBe(s.sealed);
    const pt = await openResult(sealed, s.job_id, s.device_id, await privateKey(s.device_private_key));
    expect(new TextDecoder().decode(pt)).toBe(s.plaintext_utf8);
    await expect(openResult(sealed, "job_2", s.device_id, await privateKey(s.device_private_key))).rejects.toThrow();
  });

  it("recovery: wrap key, same blob, unwraps", async () => {
    const r = v.recovery;
    const ikm = await crypto.subtle.importKey("raw", fromHex(r.entropy), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: context("recovery-key", r.user_id) }, ikm, 256);
    expect(toHex(new Uint8Array(bits))).toBe(r.wrap_key);
    expect(toHex(recoveryAad(r.user_id, r.account_device_id))).toBe(r.aad);
    const wrapKey = await recoveryWrapKey(fromHex(r.entropy), r.user_id);
    const blob = await wrapAccountKey({ wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, accountKey: fromHex(r.account_key), nonce: fromHex(r.nonce) });
    expect(toBase64Url(blob)).toBe(r.blob);
    expect(toHex(await unwrapAccountKey(blob, wrapKey, r.user_id, r.account_device_id))).toBe(r.account_key);
    await expect(unwrapAccountKey(blob, wrapKey, "usr_2", r.account_device_id)).rejects.toThrow();
  });

  it("content: same bytes, unlocks, and the context is bound", async () => {
    const c = v.content;
    const ctx = context(c.context_label, ...c.context_fields);
    expect(toHex(ctx)).toBe(c.context);
    const key = await importContentKey(fromHex(c.key));
    const locked = await lockContent(key, c.key_version, ctx, utf8(c.plaintext_utf8), fromHex(c.nonce));
    expect(toBase64Url(locked)).toBe(c.locked);
    expect(new TextDecoder().decode(await unlockContent(key, ctx, locked))).toBe(c.plaintext_utf8);
    await expect(unlockContent(key, context(c.context_label, "grp_2", "dev_phone", "note"), locked)).rejects.toThrow();
    const otherVersion = concat(locked.slice(0, 4), new Uint8Array([4]), locked.slice(5));
    await expect(unlockContent(key, ctx, otherVersion)).rejects.toThrow();
  });

  it("link passcode hash", async () => {
    const l = v.link_passcode;
    expect(await linkPasscodeHash(fromHex(l.pepper), l.link_id, l.passcode)).toBe(l.hash);
  });
});
