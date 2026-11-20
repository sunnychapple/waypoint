import { getClerkInstance } from "@clerk/expo";
import { createApiClient, type DeviceSigner } from "@waypoint/api-client";
import { randomUUID } from "expo-crypto";
import { fetch } from "expo/fetch";

const baseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? "";
let device: DeviceSigner | null = null;

// Set by src/platform/device.ts (M27a) once this iPhone is registered and approved.
export function setDeviceSigner(signer: DeviceSigner | null): void {
  device = signer;
}

export const api = createApiClient({
  baseUrl,
  fetch: (url, init) => fetch(url, init),
  getToken: async () => (await getClerkInstance().session?.getToken()) ?? null,
  device: () => device,
  now: Date.now,
  newKey: randomUUID,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
