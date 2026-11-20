import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { SymbolView } from "expo-symbols";
import { VideoSlidesResultSchema } from "@waypoint/contracts";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { getOverview, lineAt, type Overview } from "../../core/overviews/overviews.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { renderOverview } from "../../platform/overviews.ts";
import { Caption, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// One video overview (M24b): its video is made on this iPhone while the app is open, then it plays here.
export default function VideoScreen() {
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
              : "Couldn't make the video."}
          </Text>
          <PrimaryButton label="Try again" icon="arrow.clockwise" onPress={() => void renderOverview(id)} />
          <Caption>The slides are kept, so you can read them.</Caption>
          {slideHeadings(overview).map((heading, index) => (
            <Text key={index} style={[styles.lineText, { color: colors.ink }]}>{heading}</Text>
          ))}
        </>
      ) : (
        <>
          {getRecorderStatus().state !== "idle" ? (
            <Text style={[styles.note, { color: colors.ink }]}>Waiting for your recording to finish</Text>
          ) : (
            <>
              <Text style={[styles.note, { color: colors.ink }]}>Making the video… Keep Waypoint open.</Text>
              <Caption>Keep Waypoint open while the video is made.</Caption>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function slideHeadings(overview: Overview): string[] {
  return VideoSlidesResultSchema.parse(JSON.parse(overview.script)).slides.map((s) => s.heading);
}

function Player({ overview, file }: { overview: Overview; file: string }) {
  const colors = useColors();
  const player = useVideoPlayer(fileUri(file), (p) => {
    p.timeUpdateEventInterval = 0.25;
  });
  const [ms, setMs] = useState(0);
  const recording = getRecorderStatus().state !== "idle";
  const headings = slideHeadings(overview);
  const current = lineAt(overview.lineStarts, ms);

  useEffect(() => {
    const time = player.addListener("timeUpdate", (e) => setMs(e.currentTime * 1000));
    return () => time.remove();
  }, [player]);

  return (
    <>
      {recording ? (
        <Caption>Stop the recording to play.</Caption>
      ) : (
        <VideoView player={player} nativeControls style={styles.video} />
      )}

      {headings.map((heading, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`Slide ${index + 1}`}
          onPress={() => {
            player.currentTime = (overview.lineStarts[index] ?? 0) / 1000;
          }}
          style={[styles.line, index === current ? { backgroundColor: colors.accentSoft } : null]}
        >
          <Text style={[styles.lineText, { color: colors.ink }]}>{heading}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 17, lineHeight: 24 },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#000" },
  line: { padding: 8, borderRadius: 10 },
  lineText: { flex: 1, fontSize: 17, lineHeight: 25 },
});
