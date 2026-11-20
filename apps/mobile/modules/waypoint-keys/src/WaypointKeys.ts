import { requireNativeModule } from "expo";

// This device's keys for one Waypoint user (docs/security.md sections 5 and 19). Keys never leave the native side;
// public keys and signatures are base64url text. Errors carry error.code: "no_secure_enclave", "no_identity",
// "keychain", or a format error such as "badInput".
export type DeviceKeys = { deviceId: string; signPub: string; boxPub: string; hardware: boolean };
export type AccountKey = { accountId: string; signPub: string; boxPub: string; cert: string };
export type SignedRequest = { nonce: string; signature: string };
export type HeldAccountKey = { accountId: string; signPub: string; boxPub: string };
export type Certified = { cert: string; accountEnvelope: string };
export type MadeRecoveryKey = { accountId: string; words: string[]; blob: string };
export type RotatedAccountKey = {
  account: { id: string; signPub: string; boxPub: string };
  devices: { id: string; cert: string; accountEnvelope: string }[];
};

type NativeKeys = {
  getDeviceKeys(userId: string): DeviceKeys | null;
  ensureDeviceKeys(userId: string, deviceId: string): Promise<DeviceKeys>;
  deleteDeviceKeys(userId: string): Promise<void>;
  ensureAccountKey(userId: string, accountId: string): Promise<AccountKey>;
  deleteAccountKey(userId: string): Promise<void>;
  startPairing(userId: string): Promise<string>;
  signRequest(userId: string, method: string, target: string, deviceId: string, timestamp: number, body: string): Promise<SignedRequest>;
  openSealedResult(userId: string, jobId: string, sealed: string): Promise<string>;
  getAccountKey(userId: string): HeldAccountKey | null;
  newPairingNonce(): string;
  pairingCode(newSignPub: string, newBoxPub: string, commitment: string, approverSignPub: string, approverNonce: string, newNonce: string): string;
  verifyCertificate(accountSignPub: string, cert: string, userId: string, deviceId: string, signPub: string, boxPub: string): boolean;
  revealPairing(userId: string, approverSignPub: string, approverNonce: string): Promise<{ nonce: string; code: string }>;
  certifyDevice(userId: string, deviceId: string, signPub: string, boxPub: string, asAccount: boolean): Promise<Certified>;
  signRequestAsAccount(userId: string, method: string, target: string, timestamp: number, body: string): Promise<SignedRequest>;
  makeRecoveryKey(userId: string): Promise<MadeRecoveryKey>;
  recoverAccountKey(userId: string, words: string, accountId: string, blob: string, signPub: string, boxPub: string): Promise<void>;
  adoptAccountKey(userId: string, accountId: string, signPub: string, boxPub: string, envelope: string, trusted: Record<string, string>): Promise<void>;
  rotateAccountKey(userId: string, accountId: string, devices: { id: string; signPub: string; boxPub: string }[]): Promise<RotatedAccountKey>;
  finishAccountRotation(userId: string, accountId: string, keep: boolean): Promise<void>;
};

const native = requireNativeModule<NativeKeys>("WaypointKeys");

export const getDeviceKeys = (userId: string): DeviceKeys | null => native.getDeviceKeys(userId);
export const ensureDeviceKeys = (userId: string, deviceId: string): Promise<DeviceKeys> => native.ensureDeviceKeys(userId, deviceId);
export const deleteDeviceKeys = (userId: string): Promise<void> => native.deleteDeviceKeys(userId);
export const ensureAccountKey = (userId: string, accountId: string): Promise<AccountKey> => native.ensureAccountKey(userId, accountId);
export const deleteAccountKey = (userId: string): Promise<void> => native.deleteAccountKey(userId);
export const startPairing = (userId: string): Promise<string> => native.startPairing(userId);
export const signRequest = (userId: string, method: string, target: string, deviceId: string, timestamp: number, body: string): Promise<SignedRequest> =>
  native.signRequest(userId, method, target, deviceId, timestamp, body);
export const openSealedResult = (userId: string, jobId: string, sealed: string): Promise<string> => native.openSealedResult(userId, jobId, sealed);

// M27b. Errors add the codes "no_account_key", "no_pairing", "badCommitment" (the new device's nonce does not match its
// commitment: do not approve), "badRecovery" (wrong words) and "badEnvelope".
export const getAccountKey = (userId: string): HeldAccountKey | null => native.getAccountKey(userId);
export const newPairingNonce = (): string => native.newPairingNonce();
export const pairingCode = (p: { newSignPub: string; newBoxPub: string; commitment: string; approverSignPub: string; approverNonce: string; newNonce: string }): string =>
  native.pairingCode(p.newSignPub, p.newBoxPub, p.commitment, p.approverSignPub, p.approverNonce, p.newNonce);
export const verifyCertificate = (c: { accountSignPub: string; cert: string; userId: string; deviceId: string; signPub: string; boxPub: string }): boolean =>
  native.verifyCertificate(c.accountSignPub, c.cert, c.userId, c.deviceId, c.signPub, c.boxPub);
export const revealPairing = (userId: string, approverSignPub: string, approverNonce: string): Promise<{ nonce: string; code: string }> =>
  native.revealPairing(userId, approverSignPub, approverNonce);
export const certifyDevice = (userId: string, device: { id: string; signPub: string; boxPub: string }, asAccount: boolean): Promise<Certified> =>
  native.certifyDevice(userId, device.id, device.signPub, device.boxPub, asAccount);
export const signRequestAsAccount = (userId: string, method: string, target: string, timestamp: number, body: string): Promise<SignedRequest> =>
  native.signRequestAsAccount(userId, method, target, timestamp, body);
export const makeRecoveryKey = (userId: string): Promise<MadeRecoveryKey> => native.makeRecoveryKey(userId);
export const recoverAccountKey = (userId: string, words: string, account: { id: string; blob: string; signPub: string; boxPub: string }): Promise<void> =>
  native.recoverAccountKey(userId, words, account.id, account.blob, account.signPub, account.boxPub);
export const adoptAccountKey = (userId: string, account: { id: string; signPub: string; boxPub: string }, envelope: string, trusted: Record<string, string>): Promise<void> =>
  native.adoptAccountKey(userId, account.id, account.signPub, account.boxPub, envelope, trusted);
export const rotateAccountKey = (userId: string, accountId: string, devices: { id: string; signPub: string; boxPub: string }[]): Promise<RotatedAccountKey> =>
  native.rotateAccountKey(userId, accountId, devices);
export const finishAccountRotation = (userId: string, accountId: string, keep: boolean): Promise<void> => native.finishAccountRotation(userId, accountId, keep);
