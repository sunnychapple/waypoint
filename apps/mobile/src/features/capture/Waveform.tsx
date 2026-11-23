import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { EventSubscription } from "expo";
import { onRecorderLevel, setRecorderLevelsEnabled } from "../../../modules/waypoint-audio/index.ts";
import { useColors } from "../../ui/theme.ts";

const LEVELS_KEPT = 48;

// The level bars. They hold their own state, so a level event redraws only them, and they stop listening while the app
// is in the background, where nobody can see them.
export function Waveform() {
  const colors = useColors();
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    let levelEvents: EventSubscription | null = null;
    const follow = (state: string | null | undefined): void => {
      if (state === "active" && levelEvents === null) {
        levelEvents = onRecorderLevel((e) => setLevels((previous) => [...previous.slice(-(LEVELS_KEPT - 1)), e.level]));
        setRecorderLevelsEnabled(true);
      } else if (state !== "active" && levelEvents !== null) {
        levelEvents.remove();
        levelEvents = null;
        setRecorderLevelsEnabled(false);
        setLevels([]);
      }
    };
    follow(AppState.currentState);
    const appState = AppState.addEventListener("change", follow);
    return () => {
      appState.remove();
      levelEvents?.remove();
      setRecorderLevelsEnabled(AppState.currentState === "active");
    };
  }, []);

  const bars = Array.from({ length: LEVELS_KEPT }, (_, i) => levels[levels.length - LEVELS_KEPT + i] ?? 0);
  return (
    <View style={styles.waveform}>
      {bars.map((level, i) => (
        <View
          key={i}
          style={[styles.bar, { height: Math.max(3, level * 40), backgroundColor: i >= bars.length - 8 ? colors.rec : colors.ink4 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  waveform: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 44 },
  bar: { width: 3, borderRadius: 2 },
});
