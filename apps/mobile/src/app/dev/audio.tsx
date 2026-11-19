import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  getMicPermission,
  onRecorderLevel,
  onRecorderPart,
  onRecorderState,
  pauseRecording,
  requestMicPermission,
  resumeRecording,
  startRecording,
  stopRecording,
  type MicPermission,
  type PartEvent,
  type StateEvent,
} from "../../../modules/waypoint-audio/index.ts";
import { useColors } from "../../ui/theme.ts";

// Developer check screen for M5. Reached only by the URL waypoint://dev/audio; nothing links to it.
const SESSION_ID = "dev-audio";

export default function DevAudioScreen() {
  const colors = useColors();
  const [permission, setPermission] = useState<MicPermission>("undetermined");
  const [lastState, setLastState] = useState<StateEvent | null>(null);
  const [parts, setParts] = useState<PartEvent[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMicPermission().then(setPermission).catch((e: unknown) => setError(String(e)));
    const subscriptions = [
      onRecorderState(setLastState),
      onRecorderPart((part) => setParts((previous) => [...previous, part])),
      onRecorderLevel((event) => setLevel(event.level)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  const attempt = (promise: Promise<unknown>) => {
    setError(null);
    promise.catch((e: unknown) => setError(String(e)));
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.text, { color: colors.ink }]}>Microphone: {permission}</Text>
      <View style={styles.row}>
        <Button label="Permission" onPress={() => attempt(requestMicPermission().then(setPermission))} />
        <Button label="Start" onPress={() => attempt(startRecording(SESSION_ID))} />
        <Button label="Pause" onPress={() => attempt(pauseRecording())} />
        <Button label="Resume" onPress={() => attempt(resumeRecording())} />
        <Button label="Stop" onPress={() => attempt(stopRecording())} />
      </View>
      <View style={[styles.meter, { backgroundColor: colors.surface3 }]}>
        <View style={[styles.meterFill, { width: level * 300, backgroundColor: colors.accent }]} />
      </View>
      {error ? <Text style={[styles.text, { color: colors.danger }]}>{error}</Text> : null}
      <Text style={[styles.text, { color: colors.ink }]}>
        State: {lastState ? JSON.stringify(lastState) : "none yet"}
      </Text>
      <Text style={[styles.heading, { color: colors.ink }]}>Parts</Text>
      {parts.map((part) => (
        <Text key={`${part.sessionId}-${part.index}`} style={[styles.text, { color: colors.ink2 }]}>
          {JSON.stringify(part)}
        </Text>
      ))}
    </ScrollView>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={[styles.button, { backgroundColor: colors.accentSoft }]}>
      <Text style={[styles.buttonText, { color: colors.accentStrong }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  meter: { height: 12, borderRadius: 6, overflow: "hidden" },
  meterFill: { height: 12 },
  heading: { fontSize: 17, fontWeight: "600" },
  text: { fontSize: 14 },
});
