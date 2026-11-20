import { requireNativeModule } from "expo";

// On-device voices (M22b). Errors carry error.code: "no_voices" (fewer than two voices for any language),
// "busy" (a render is running), "cancelled", "write_failed".
export type ScriptLineIn = { voice: "A" | "B"; text: string };
export type Rendered = { durationMs: number; lineStartsMs: number[]; voices: string };

type NativeVoices = {
  renderScript(lines: ScriptLineIn[], outPath: string, language: string): Promise<Rendered>;
  cancelRender(): void;
};

const native = requireNativeModule<NativeVoices>("WaypointVoices");

// outPath is relative to the app's Documents folder, for example "overviews/<job id>.m4a". language: BCP 47.
export const renderScript = (lines: ScriptLineIn[], outPath: string, language: string): Promise<Rendered> => native.renderScript(lines, outPath, language);
export const cancelRender = (): void => native.cancelRender();
