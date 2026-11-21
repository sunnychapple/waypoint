import { useRef } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { formatClock, formatOffset } from "../../core/format.ts";
import { Body, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { WordText } from "../../ui/WordText.tsx";
import { useColors } from "../../ui/theme.ts";
import { TimeMarkRow } from "./TimelineMarks.tsx";
import { useRecording, type Banner, type TimelineItem } from "./useRecording.ts";

const PAUSE_REASONS: Record<string, string> = {
  interruption: "Paused for a call or another app.",
  route_change: "The microphone changed.",
  media_reset: "Audio restarted.",
  write_failed: "Your iPhone couldn't save the recording. Free up some space, then resume.",
};

// The live recording screen (C1, C3, C8, P5, P11, cut to stage 1). It cannot be swiped away; the close button asks first.
export default function RecordScreen() {
  const colors = useColors();
  const model = useRecording();

  function close(): void {
    if (model.phase !== "recording") {
      router.back();
      return;
    }
    Alert.alert("End this recording?", "Discarding deletes its audio, photos and words.", [
      { text: "Keep recording", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: model.discard },
      { text: "Stop and save", onPress: model.stop },
    ]);
  }

  if (model.phase === "checking") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.topRow}>
          <CircleButton label="Close" icon="chevron.down" onPress={close} />
        </View>
      </SafeAreaView>
    );
  }

  if (model.phase === "denied") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
        <CircleButton label="Close" icon="chevron.down" onPress={close} />
        <View style={styles.centered}>
          <View style={[styles.micOff, { backgroundColor: colors.recSoft }]}>
            <SymbolView name="mic.slash.fill" tintColor={colors.rec} size={36} />
          </View>
          <Title style={styles.centeredText}>NotePath can't hear yet</Title>
          <Body style={styles.centeredText}>Turn on the microphone in Settings to record. You can still snap pages.</Body>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
          <SecondaryButton label="Snap pages instead" onPress={() => router.replace("/pages/new")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Transcript model={model} onClose={close} />
      <Dock model={model} />
    </SafeAreaView>
  );
}

type Model = ReturnType<typeof useRecording>;

function Transcript({ model, onClose }: { model: Model; onClose: () => void }) {
  const colors = useColors();
  const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const paused = model.recorder === "paused";
  const showPause = paused && model.pauseReason !== "user" && model.pauseReason !== "none";

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    following.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 40;
  }

  return (
    <View style={styles.transcriptArea}>
      <View style={styles.topRow}>
        <CircleButton label="Close" icon="chevron.down" onPress={onClose} />
        <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <SymbolView name="folder.fill" tintColor={colors.ink3} size={14} />
          <Text style={[styles.pillText, { color: colors.ink }]}>{model.spaceName}</Text>
        </View>
        <View style={styles.spacer} />
      </View>
      <Title>New recording</Title>

      {model.banner ? <BannerView banner={model.banner} /> : null}
      {showPause ? (
        <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
          <View style={styles.cardHead}>
            <SymbolView name="phone.fill" tintColor={colors.flag} size={20} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.flagInk }]}>Recording paused at {formatClock(model.clockMs)}</Text>
              <Text style={[styles.cardBody, { color: colors.flagInk }]}>{PAUSE_REASONS[model.pauseReason] ?? ""}</Text>
              <Text style={[styles.cardBody, { color: colors.flagInk }]}>Nothing before {formatClock(model.clockMs)} was lost.</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resume recording"
              onPress={model.resume}
              style={[styles.wideButton, { backgroundColor: colors.rec }]}
            >
              <SymbolView name="mic.fill" tintColor={colors.onRec} size={16} />
              <Text style={[styles.buttonText, { color: colors.onRec }]}>Resume recording</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save and stop"
              onPress={model.stop}
              style={[styles.wideButton, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.buttonText, { color: colors.ink }]}>Save & stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.lines}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (following.current) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {model.timeline.map((item) => (
          <TimelineRow key={item.key} item={item} sessionId={model.sessionId} />
        ))}
        {model.volatile ? (
          <View style={styles.line}>
            <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(model.volatile.tStart)}</Text>
            <Text style={[styles.lineText, { color: colors.ink3 }]}>{model.volatile.text}</Text>
          </View>
        ) : null}
      </ScrollView>

      {model.toast ? (
        <View style={[styles.toast, { backgroundColor: colors.ink }]}>
          <SymbolView name="flag.fill" tintColor={colors.flag} size={14} />
          <Text style={[styles.toastText, { color: colors.bg }]}>Flagged at {formatOffset(model.toast.t)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function TimelineRow({ item, sessionId }: { item: TimelineItem; sessionId: string | null }) {
  const colors = useColors();
  switch (item.kind) {
    case "line":
      return (
        <View style={styles.line}>
          <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(item.at)}</Text>
          <WordText
            text={item.text}
            style={[styles.lineText, { color: colors.ink }]}
            onWord={(word) => {
              if (sessionId !== null) router.push({ pathname: "/explain", params: { sessionId, t: String(item.at), word } });
            }}
          />
        </View>
      );
    case "gap":
    case "flag":
    case "photo":
      return <TimeMarkRow item={item} />;
  }
}

function BannerView({ banner }: { banner: Banner }) {
  const colors = useColors();
  if (banner === null) return null;
  if (banner.kind === "unsupported") {
    return (
      <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
        <Text style={[styles.cardBody, { color: colors.flagInk }]}>This iPhone can't write down this language yet. Your audio is saved.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
      <Text style={[styles.cardTitle, { color: colors.flagInk }]}>Recording now. Words appear when the speech pack finishes downloading.</Text>
      <View style={[styles.progressTrack, { backgroundColor: colors.surface }]}>
        <View style={[styles.progressFill, { width: `${banner.percent}%`, backgroundColor: colors.flag }]} />
      </View>
      <Text style={[styles.cardBody, { color: colors.flagInk }]}>{banner.percent}% · your audio is safe either way</Text>
    </View>
  );
}

function Dock({ model }: { model: Model }) {
  const colors = useColors();
  const paused = model.recorder === "paused";
  const live = model.recorder === "recording";
  return (
    <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: live ? colors.rec : colors.ink4 }]} />
        <Text style={[styles.clock, { color: colors.ink }]} accessibilityLabel={`Recorded ${formatClock(model.clockMs)}`}>
          {formatClock(model.clockMs)}
        </Text>
        <View style={styles.flex} />
        <CircleButton
          label={paused ? "Resume" : "Pause"}
          icon={paused ? "play.fill" : "pause.fill"}
          onPress={paused ? model.resume : model.pause}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          disabled={model.stopping}
          onPress={model.stop}
          style={[styles.stop, { backgroundColor: colors.rec, opacity: model.stopping ? 0.5 : 1 }]}
        >
          <SymbolView name="stop.fill" tintColor={colors.onRec} size={14} />
          <Text style={[styles.buttonText, { color: colors.onRec }]}>Stop</Text>
        </Pressable>
      </View>

      <View style={styles.waveform}>
        {model.levels.map((level, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: Math.max(3, level * 40),
                backgroundColor: i >= model.levels.length - 8 ? colors.rec : colors.ink4,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <ActionButton label="Photo" icon="camera.fill" onPress={model.photo} />
        <ActionButton label="Flag" icon="flag.fill" onPress={model.flag} flag />
      </View>
    </View>
  );
}

function ActionButton({ label, icon, onPress, flag }: { label: string; icon: SFSymbol; onPress: () => void; flag?: boolean }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}>
      <View style={[styles.actionCircle, { backgroundColor: flag ? colors.flag : colors.surface2 }]}>
        <SymbolView name={icon} tintColor={flag ? colors.flagInk : colors.ink} size={flag ? 26 : 20} />
      </View>
      <Text style={[styles.actionLabel, { color: colors.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

function CircleButton({ label, icon, onPress }: { label: string; icon: SFSymbol; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.circle, { backgroundColor: colors.surface }]}>
      <SymbolView name={icon} tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { width: 44 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  centeredText: { textAlign: "center" },
  micOff: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  footer: { padding: 20, gap: 12 },
  transcriptArea: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 15, fontWeight: "600" },
  card: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  cardHead: { flexDirection: "row", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardBody: { fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6 },
  lines: { gap: 12, paddingBottom: 12 },
  line: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 44, paddingTop: 2 },
  lineText: { flex: 1, fontSize: 17, lineHeight: 24 },
  toast: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  toastText: { fontSize: 14, fontWeight: "600" },
  dock: { margin: 12, padding: 16, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  clock: { fontSize: 26, fontWeight: "600", fontVariant: ["tabular-nums"] },
  stop: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  wideButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14 },
  waveform: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 44 },
  bar: { width: 3, borderRadius: 2 },
  actions: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end" },
  action: { alignItems: "center", gap: 6, width: 80 },
  actionCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 13 },
});
