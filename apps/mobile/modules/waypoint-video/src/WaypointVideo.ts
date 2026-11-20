import { requireNativeModule } from "expo";

// Errors carry error.code: "bad_input", "no_audio", "write_failed", "busy".
export type SlideIn = { heading: string; bullets: string[] };

type NativeVideo = {
  renderSlides(title: string, slides: SlideIn[], slideStartsMs: number[], audioPath: string, outPath: string): Promise<{ durationMs: number }>;
};

const native = requireNativeModule<NativeVideo>("WaypointVideo");

// Paths are relative to Documents. slideStartsMs: when each slide's narration starts in the audio file (M22b's
// lineStartsMs). The title is drawn on the first slide above its heading.
export const renderSlides = (title: string, slides: SlideIn[], slideStartsMs: number[], audioPath: string, outPath: string): Promise<{ durationMs: number }> =>
  native.renderSlides(title, slides, slideStartsMs, audioPath, outPath);
