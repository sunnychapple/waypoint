import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { cancelRender, renderScript, type ScriptLineIn } from "../../../modules/waypoint-voices/index.ts";
import { useColors } from "../../ui/theme.ts";

// M22b's device check, development builds only. The result shows the voice pair the iPhone picked (`voices`).
function lines(count: number): ScriptLineIn[] {
  return Array.from({ length: count }, (_, i) => ({ voice: i % 2 === 0 ? "A" : "B", text: `Line ${i + 1}. Cells are the smallest units of life.` }));
}

function messageOf(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
  return code !== "" ? code : e instanceof Error ? e.message : String(e);
}

export default function DevVoices() {
  const colors = useColors();
  const [message, setMessage] = useState("");

  async function render(count: number) {
    setMessage(`Rendering ${count} lines…`);
    try {
      const r = await renderScript(lines(count), `overviews/dev-${count}.m4a`, "en-US");
      setMessage(`voices: ${r.voices}\ndurationMs: ${r.durationMs}\nlineStartsMs: ${r.lineStartsMs.slice(0, 8).join(", ")}`);
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  const button = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 14 }}>
      <Text style={{ color: colors.ink, fontWeight: "600", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 60, gap: 12 }}>
      {button("Render 4 lines", () => void render(4))}
      {button("Render 200 lines", () => void render(200))}
      {button("Cancel", cancelRender)}
      <Text selectable style={{ color: colors.ink }}>
        {message}
      </Text>
    </ScrollView>
  );
}
