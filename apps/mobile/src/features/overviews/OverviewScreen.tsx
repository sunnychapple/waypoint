import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { formatClock } from "../../core/format.ts";
import { getOverview, lineAt, spokenLines, type Overview } from "../../core/overviews/overviews.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { renderOverview } from "../../platform/overviews.ts";
import { Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const RATES = [1, 1.25, 1.5] as const;

// One audio overview (M23): its voices are made on this iPhone while the app is open, then it plays here.
export default function OverviewScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const overview = useQuery((db) => getOverview(db, id), id);

  useEffect(() => {
    if (overview?.state === "script") void renderOverview(id);
  }, [id, overview?.state]);

  if (overview === null) return <Screen>{null}</Screen>;
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
      </Pressable>
      <Title>{overview.title}</Title>

      {overview.state === "ready" && overview.file !== null ? (
        <Player overview={overview} file={overview.file} />
      ) : overview.state === "failed" || overview.state === "no_voices" ? (
        <>
          <Text style={[styles.note, { color: colors.ink }]}>
            {overview.state === "no_voices"
              ? "This iPhone needs two voices for this language. Add one in Settings › Accessibility › Spoken Content, then try again."
              : "Couldn't make the voices."}
          </Text>
          <PrimaryButton label="Try again" icon="arrow.clockwise" onPress={() => void renderOverview(id)} />
          <Caption>The script is kept, so you can read it.</Caption>
          {spokenLines(overview).map((line, index) => (
            <Text key={index} style={[styles.lineText, { color: colors.ink }]}>{`${line.voice}  ${line.text}`}</Text>
          ))}
        </>
      ) : (
        <>
          <Text style={[styles.note, { color: colors.ink }]}>Making the voices…</Text>
          <Caption>Keep Waypoint open while the voices are made.</Caption>
        </>
      )}
    </Screen>
  );
}

function Player({ overview, file }: { overview: Overview; file: string }) {
  const colors = useColors();
  const player = useAudioPlayer(fileUri(file));
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const recording = getRecorderStatus().state !== "idle";
  const lines = spokenLines(overview);
  const current = lineAt(overview.lineStarts, status.currentTime * 1000);

  async function togglePlay(): Promise<void> {
    if (recording) return;
    if (status.playing) {
      player.pause();
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    player.setPlaybackRate(rate);
    player.play();
  }

  function cycleRate(): void {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    setRate(next);
    player.setPlaybackRate(next);
  }

  return (
    <>
      <View style={styles.controls}>
        <SecondaryButton label="Back 15 seconds" icon="gobackward.15" onPress={() => void player.seekTo(Math.max(0, status.currentTime - 15))} />
        <PrimaryButton
          label={recording ? "Stop the recording to play" : status.playing ? "Pause" : "Play"}
          icon={status.playing ? "pause.fill" : "play.fill"}
          onPress={() => void togglePlay()}
        />
        <SecondaryButton label={`${rate}×`} icon="speedometer" onPress={cycleRate} />
      </View>
      <Caption>{`${formatClock(status.currentTime * 1000)} / ${formatClock(overview.durationMs ?? 0)}`}</Caption>
      <Caption>Voices made on this iPhone.</Caption>

      {lines.map((line, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`Line ${index + 1}`}
          onPress={() => void player.seekTo((overview.lineStarts[index] ?? 0) / 1000)}
          style={[styles.line, index === current ? { backgroundColor: colors.accentSoft } : null]}
        >
          <Text style={[styles.lineHost, { color: colors.ink3 }]}>{line.voice}</Text>
          <Text style={[styles.lineText, { color: colors.ink }]}>{line.text}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 17, lineHeight: 24 },
  controls: { gap: 12 },
  line: { flexDirection: "row", gap: 12, padding: 8, borderRadius: 10 },
  lineHost: { width: 16, fontSize: 15, fontWeight: "600" },
  lineText: { flex: 1, fontSize: 17, lineHeight: 25 },
});
