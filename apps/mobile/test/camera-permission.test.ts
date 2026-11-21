import { beforeEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({
  getCameraPermissionsAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
}));

vi.mock("expo-image-picker", () => ({
  PermissionStatus: { UNDETERMINED: "undetermined", GRANTED: "granted", DENIED: "denied" },
  getCameraPermissionsAsync: picker.getCameraPermissionsAsync,
  requestCameraPermissionsAsync: picker.requestCameraPermissionsAsync,
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  AppState: { addEventListener: vi.fn() },
  Linking: { openSettings: vi.fn() },
  StyleSheet: { create: <T>(styles: T) => styles },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  useColorScheme: () => "light",
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
vi.mock("../modules/waypoint-pages/index.ts", () => ({ importImage: vi.fn(), isScannerSupported: () => true, scanPages: vi.fn() }));
vi.mock("../src/platform/db.ts", () => ({ writeDb: vi.fn(), useQuery: vi.fn() }));
vi.mock("../src/platform/files.ts", () => ({ deleteSessionFiles: vi.fn(), fileUri: (p: string) => p, deleteFile: vi.fn() }));

import { cameraAllowed } from "../src/features/capture/NewPagesScreen.tsx";

describe("cameraAllowed", () => {
  beforeEach(() => {
    picker.getCameraPermissionsAsync.mockReset();
    picker.requestCameraPermissionsAsync.mockReset();
  });

  it("is allowed when the camera is already granted, without asking again", async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ status: "granted", granted: true });
    expect(await cameraAllowed()).toBe(true);
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks when the student has not been asked yet, and goes with the answer", async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ status: "granted", granted: true });
    expect(await cameraAllowed()).toBe(true);
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalledOnce();
  });

  it("is blocked when the camera is denied, without asking again", async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ status: "denied", granted: false });
    expect(await cameraAllowed()).toBe(false);
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it("is blocked when the student declines the prompt", async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ status: "denied", granted: false });
    expect(await cameraAllowed()).toBe(false);
  });
});
