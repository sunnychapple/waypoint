import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { renderScript, type ScriptLineIn } from "../../../modules/waypoint-voices/index.ts";
import { renderSlides, type SlideIn } from "../../../modules/waypoint-video/index.ts";
import { useColors } from "../../ui/theme.ts";

// M24a's device check, development builds only. Renders three slides over an M22b narration; the slides change when
// their narration starts. Reached only by the URL waypoint://dev/video; nothing links to it.
const SLIDES: SlideIn[] = [
  { heading: "Cells", bullets: ["The smallest units of life", "Most are too small to see without a microscope"] },
  { heading: "Membranes", bullets: ["Control what enters and leaves", "Made mostly of lipids and proteins"] },
  { heading: "Nucleus", bullets: ["Holds the DNA", "Directs what the cell does"] },
];

const NARRATION: ScriptLineIn[] = [
  { voice: "A", text: "Cells are the smallest units of life." },
  { voice: "B", text: "Each one is surrounded by a membrane that controls what passes through." },
  { voice: "A", text: "The nucleus holds the DNA and directs what the cell does." },
];

const NARRATION_PATH = "overviews/dev-video-narration.m4a";
const VIDEO_PATH = "overviews/dev-video.mp4";

function messageOf(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
  return code !== "" ? code : e instanceof Error ? e.message : String(e);
}

export default function DevVideo() {
  const colors = useColors();
  const [message, setMessage] = useState("");

  async function render() {
    setMessage("Rendering…");
    try {
      const narration = await renderScript(NARRATION, NARRATION_PATH, "en-US");
      const video = await renderSlides("Cells", SLIDES, narration.lineStartsMs, NARRATION_PATH, VIDEO_PATH);
      setMessage(`durationMs: ${video.durationMs}\nnarrationMs: ${narration.durationMs}\nslideStartsMs: ${narration.lineStartsMs.join(", ")}\nfile: Documents/${VIDEO_PATH}`);
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 60, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => void render()} style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 14 }}>
        <Text style={{ color: colors.ink, fontWeight: "600", textAlign: "center" }}>Render 3 slides</Text>
      </Pressable>
      <Text selectable style={{ color: colors.ink }}>
        {message}
      </Text>
    </ScrollView>
  );
}
