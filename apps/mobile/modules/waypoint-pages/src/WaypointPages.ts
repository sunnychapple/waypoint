import { requireNativeModule } from "expo";

export type ScannedPage = { file: string; width: number; height: number };
export type PageLine = { text: string; x: number; y: number; width: number; height: number };
export type PageText = { text: string; lines: PageLine[] };

type NativePages = {
  isScannerSupported(): boolean;
  scanPages(sessionId: string): Promise<ScannedPage[]>; // [] when cancelled
  readPage(file: string): Promise<PageText>;
  importImage(sessionId: string, sourceUri: string): Promise<ScannedPage>;
};

const native = requireNativeModule<NativePages>("WaypointPages");

export const isScannerSupported = (): boolean => native.isScannerSupported();
export const scanPages = (sessionId: string): Promise<ScannedPage[]> => native.scanPages(sessionId);
export const readPage = (file: string): Promise<PageText> => native.readPage(file);
export const importImage = (sessionId: string, sourceUri: string): Promise<ScannedPage> => native.importImage(sessionId, sourceUri);
