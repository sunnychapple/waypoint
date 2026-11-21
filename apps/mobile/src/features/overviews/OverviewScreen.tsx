import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { getAvailability } from "../../../modules/waypoint-model/index.ts";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { formatClock } from "../../core/format.ts";
import { getOverview, lineAt, spokenLines, type Overview } from "../../core/overviews/overviews.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { renderOverview } from "../../platform/overviews.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
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
          <Caption>Keep NotePath open while the voices are made.</Caption>
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
  // The end card shows once playback reaches the end; any seek or play takes it away.
  const [ended, setEnded] = useState(false);
  // "· free" only where the study sets are made on this iPhone (as on Your pages).
  const [onDevice] = useState(() => getAvailability() === "available");
  const free = onDevice ? " · free" : "";
  const recording = getRecorderStatus().state !== "idle";
  const lines = spokenLines(overview);
  const current = lineAt(overview.lineStarts, status.currentTime * 1000);

  useEffect(() => {
    if (status.didJustFinish) setEnded(true);
  }, [status.didJustFinish]);

  async function togglePlay(): Promise<void> {
    if (recording) return;
    if (status.playing) {
      player.pause();
      return;
    }
    // At the end of the file play() alone does nothing, so start again from 0:00.
    if (ended) await player.seekTo(0);
    setEnded(false);
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    player.setPlaybackRate(rate);
    player.play();
  }

  async function playAgain(): Promise<void> {
    if (recording) return;
    setEnded(false);
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    await player.seekTo(0);
    player.setPlaybackRate(rate);
    player.play();
  }

  function seekBack(): void {
    setEnded(false);
    void player.seekTo(Math.max(0, status.currentTime - 15));
  }

  function seekToLine(index: number): void {
    setEnded(false);
    void player.seekTo((overview.lineStarts[index] ?? 0) / 1000);
  }

  function cycleRate(): void {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    setRate(next);
    player.setPlaybackRate(next);
  }

  return (
    <>
      <View style={styles.controls}>
        <SecondaryButton label="Back 15 seconds" icon="gobackward.15" onPress={seekBack} />
        <PrimaryButton
          label={recording ? "Stop the recording to play" : status.playing ? "Pause" : "Play"}
          icon={status.playing ? "pause.fill" : "play.fill"}
          onPress={() => void togglePlay()}
        />
        <SecondaryButton label={`${rate}×`} icon="speedometer" onPress={cycleRate} />
      </View>
      <Caption>{`${formatClock(status.currentTime * 1000)} / ${formatClock(overview.durationMs ?? 0)}`}</Caption>
      <Caption>Voices made on this iPhone.</Caption>

      {ended ? (
        <View style={styles.end}>
          <Body>Want to check it stuck?</Body>
          {overview.sessionId !== null ? (
            <>
              <PrimaryButton label={`Quiz me on this${free}`} icon="checklist" onPress={() => router.push(`/study/quiz?sessionId=${overview.sessionId}`)} />
              <SecondaryButton label="Make cards" icon="square.stack.3d.up" onPress={() => router.push(`/study/make?sessionId=${overview.sessionId}`)} />
            </>
          ) : null}
          <SecondaryButton label="Play again" icon="arrow.counterclockwise" onPress={() => void playAgain()} />
        </View>
      ) : null}

      {lines.map((line, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`Line ${index + 1}`}
          onPress={() => seekToLine(index)}
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
  end: { gap: 12 },
  line: { flexDirection: "row", gap: 12, padding: 8, borderRadius: 10 },
  lineHost: { width: 16, fontSize: 15, fontWeight: "600" },
  lineText: { flex: 1, fontSize: 17, lineHeight: 25 },
});
