import { requireNativeModule } from "expo";

// This device's keys for one Waypoint user (docs/security.md sections 5 and 19). Keys never leave the native side;
// public keys and signatures are base64url text. Errors carry error.code: "no_secure_enclave", "no_identity",
// "keychain", or a format error such as "badInput".
export type DeviceKeys = { deviceId: string; signPub: string; boxPub: string; hardware: boolean };
export type AccountKey = { accountId: string; signPub: string; boxPub: string; cert: string };
export type SignedRequest = { nonce: string; signature: string };

type NativeKeys = {
  getDeviceKeys(userId: string): DeviceKeys | null;
  ensureDeviceKeys(userId: string, deviceId: string): Promise<DeviceKeys>;
  deleteDeviceKeys(userId: string): Promise<void>;
  ensureAccountKey(userId: string, accountId: string): Promise<AccountKey>;
  deleteAccountKey(userId: string): Promise<void>;
  startPairing(userId: string): Promise<string>;
  signRequest(userId: string, method: string, target: string, deviceId: string, timestamp: number, body: string): Promise<SignedRequest>;
  openSealedResult(userId: string, jobId: string, sealed: string): Promise<string>;
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
