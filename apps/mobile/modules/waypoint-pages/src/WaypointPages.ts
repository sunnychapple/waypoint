import { requireNativeModule } from "expo";

export type ScannedPage = { file: string; width: number; height: number };
export type PageLine = { text: string; x: number; y: number; width: number; height: number };
export type PageText = { text: string; lines: PageLine[] };
export type CameraResult =
  | { kind: "photo"; file: string; width: number; height: number; capturedAt: number } // capturedAt: epoch ms at the shutter
  | { kind: "page" }
  | { kind: "cancelled" };

type NativePages = {
  isScannerSupported(): boolean;
  scanPages(sessionId: string): Promise<ScannedPage[]>; // [] when cancelled
  openCamera(sessionId: string): Promise<CameraResult>; // rejects with code camera_denied (access off) or camera_restricted (turned off)
  readPage(file: string): Promise<PageText>;
  importImage(sessionId: string, sourceUri: string): Promise<ScannedPage>;
};

const native = requireNativeModule<NativePages>("WaypointPages");

export const isScannerSupported = (): boolean => native.isScannerSupported();
export const scanPages = (sessionId: string): Promise<ScannedPage[]> => native.scanPages(sessionId);
export const openCamera = (sessionId: string): Promise<CameraResult> => native.openCamera(sessionId);
export const readPage = (file: string): Promise<PageText> => native.readPage(file);
export const importImage = (sessionId: string, sourceUri: string): Promise<ScannedPage> => native.importImage(sessionId, sourceUri);
