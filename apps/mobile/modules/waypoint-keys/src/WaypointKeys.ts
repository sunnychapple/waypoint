import { requireNativeModule } from "expo";

// This device's keys for one Waypoint user (docs/security.md sections 5 and 19). Keys never leave the native side;
// public keys and signatures are base64url text. Errors carry error.code: "no_secure_enclave", "no_identity",
// "keychain", or a format error such as "badInput".
export type DeviceKeys = { deviceId: string; signPub: string; boxPub: string; hardware: boolean };
// cert: this device's certificate. selfCert: the account key's certificate for its own row (docs/security.md section 6).
export type AccountKey = { accountId: string; signPub: string; boxPub: string; cert: string; selfCert: string };
export type SignedRequest = { nonce: string; signature: string };
export type HeldAccountKey = { accountId: string; signPub: string; boxPub: string };
export type Certified = { cert: string; accountEnvelope: string };
export type MadeRecoveryKey = { accountId: string; words: string[]; blob: string };
export type RotatedAccountKey = {
  account: { id: string; signPub: string; boxPub: string; selfCert: string };
  devices: { id: string; cert: string; accountEnvelope: string }[];
};

// M28a. Group keys stay in the Keychain; these return ids, public keys, envelopes, locked bytes and file paths only.
export type GroupSigner = { id: string; userId: string; signPub: string; boxPub: string; cert: string };
export type GroupEnvelope = { keyVersion: number; wrappedKey: string };
export type OpenGroupKeysResult = { opened: number[]; refused: number[] };
export type LockLabel = "change" | "group-name" | "snapshot";
export type WrapGroupKeysResult = { envelopes: WrappedFor[]; refused: string[] };
export type KeyTarget = { id: string; userId: string; kind: "device" | "account"; signPub: string; boxPub: string; cert: string | null };
export type WrappedFor = { deviceId: string; keyVersion: number; wrappedKey: string };
export const wrapGroupKeys = (userId: string, groupId: string, keyVersions: number[], recipients: KeyTarget[], knownAccounts: Record<string, string>): Promise<{ envelopes: WrappedFor[]; refused: string[] }> =>
  native.wrapGroupKeys(userId, groupId, keyVersions, recipients.map((r) => ({ ...r, cert: r.cert ?? "" })), knownAccounts);

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
  makeGroupKey(userId: string, groupId: string, keyVersion: number): Promise<void>;
  dropGroupKey(userId: string, groupId: string, keyVersion: number): Promise<void>;
  heldGroupKeyVersions(userId: string, groupId: string): number[];
  wrapGroupKeys(userId: string, groupId: string, keyVersions: number[], recipients: Record<string, string>[], knownAccounts: Record<string, string>): Promise<WrapGroupKeysResult>;
  openGroupKeys(userId: string, groupId: string, recipientId: string, envelopes: GroupEnvelope[], signers: GroupSigner[], knownAccounts: Record<string, string>): Promise<OpenGroupKeysResult>;
  lockContent(userId: string, groupId: string, keyVersion: number, label: LockLabel, fields: string[], plaintext: string): Promise<string>;
  unlockContent(userId: string, groupId: string, label: LockLabel, fields: string[], locked: string): Promise<string>;
  lockFile(userId: string, groupId: string, keyVersion: number, blobId: string, inPath: string, outPath: string): Promise<number>;
  unlockFile(userId: string, groupId: string, blobId: string, inPath: string, outPath: string): Promise<void>;
  lockLink(linkId: string, plaintext: string): Promise<{ key: string; data: string }>;
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

export const makeGroupKey = (userId: string, groupId: string, keyVersion: number): Promise<void> => native.makeGroupKey(userId, groupId, keyVersion);
export const dropGroupKey = (userId: string, groupId: string, keyVersion: number): Promise<void> => native.dropGroupKey(userId, groupId, keyVersion);
export const heldGroupKeyVersions = (userId: string, groupId: string): number[] => native.heldGroupKeyVersions(userId, groupId);
export const openGroupKeys = (
  userId: string, groupId: string, recipientId: string, envelopes: GroupEnvelope[], signers: GroupSigner[], knownAccounts: Record<string, string>
): Promise<OpenGroupKeysResult> => native.openGroupKeys(userId, groupId, recipientId, envelopes, signers, knownAccounts);
export const lockContent = (userId: string, groupId: string, keyVersion: number, label: LockLabel, fields: string[], plaintext: string): Promise<string> =>
  native.lockContent(userId, groupId, keyVersion, label, fields, plaintext);
export const unlockContent = (userId: string, groupId: string, label: LockLabel, fields: string[], locked: string): Promise<string> =>
  native.unlockContent(userId, groupId, label, fields, locked);
export const lockFile = (userId: string, groupId: string, keyVersion: number, blobId: string, inPath: string, outPath: string): Promise<number> =>
  native.lockFile(userId, groupId, keyVersion, blobId, inPath, outPath);
export const unlockFile = (userId: string, groupId: string, blobId: string, inPath: string, outPath: string): Promise<void> =>
  native.unlockFile(userId, groupId, blobId, inPath, outPath);
export const lockLink = (linkId: string, plaintext: string): Promise<{ key: string; data: string }> => native.lockLink(linkId, plaintext);
