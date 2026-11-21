import { getClerkInstance } from "@clerk/expo";
import { createApiClient, type DeviceSigner } from "@waypoint/api-client";
import { randomUUID } from "expo-crypto";
import { fetch } from "expo/fetch";

// The API host with no trailing slash, so "<host>/v1/..." and "<host>/i/..." never get a double slash.
export function apiBaseFrom(raw: string | undefined): string {
  return (raw ?? "").replace(/\/+$/, "");
}

const baseUrl: string = apiBaseFrom(process.env.EXPO_PUBLIC_API_URL);
// The API host (no trailing slash), for the links the app shares (an invite is <host>/i/<token>).
export const apiBaseUrl: string = baseUrl;
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
