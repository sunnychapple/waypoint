import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { cleanName, lineMarks, linesToName, SEVERAL, setSpeaker, SPEAKER_MAX_CHARS, speakerNames } from "../../core/capture/marks.ts";
import { listSegments } from "../../core/capture/segments.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { dbGeneration, useQuery, writeDbIf } from "../../platform/db.ts";
import { Caption, PrimaryButton, Row, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now };

// S14 and notes 2, 3 and 19: who said the chosen lines. A name saved in this space is one tap, and Several people is for a
// group. Names are kept as words on the lines, never anything about a voice.
export default function SpeakerSheet() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId: string; lines?: string }>();
  const sessionId = params.sessionId;
  const starts = (params.lines ?? "")
    .split(",")
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  const [generation] = useState(dbGeneration);
  const [choice, setChoice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"these" | "until">("these");
  const data = useQuery((db) => {
    const session = getSession(db, sessionId);
    if (session === null) return null;
    const marks = new Map(lineMarks(db, sessionId).map((mark) => [mark.tStart, mark]));
    const names = new Set(starts.map((t) => marks.get(t)?.speaker ?? null));
    const [only] = [...names];
    return {
      spaceName: getSpace(db, session.spaceId)?.name ?? "",
      saved: speakerNames(db, session.spaceId),
      current: names.size === 1 ? (only ?? null) : null,
      lines: listSegments(db, sessionId).map((line) => ({ tStart: line.tStart, speaker: marks.get(line.tStart)?.speaker ?? null })),
    };
  }, `${sessionId}|${params.lines ?? ""}`);

  if (data === null || starts.length === 0) {
    return (
      <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
        <Caption>These lines aren't here any more.</Caption>
        <SecondaryButton label="Close" onPress={() => router.back()} />
      </View>
    );
  }

  const chosen = typing ? cleanName(draft) : (choice ?? data.current);
  const pick = (name: string): void => {
    setTyping(false);
    setChoice(name);
  };
  const check = (name: string) => (!typing && chosen === name ? <SymbolView name="checkmark" tintColor={colors.accent} size={16} /> : null);

  function save(name: string | null): void {
    if (data === null) return;
    const lines = name !== null && scope === "until" ? linesToName(data.lines, starts) : starts;
    try {
      writeDbIf(generation, (db) => setSpeaker(db, deps, sessionId, lines, name));
    } catch {
      Alert.alert("Couldn't save this name.");
      return;
    }
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.sheet}>
      <Title>Who's talking?</Title>
      <Caption>{`Saved in ${data.spaceName}`}</Caption>
      {data.saved.map((name) => (
        <Row key={name} title={name} selected={!typing && chosen === name} right={check(name)} onPress={() => pick(name)} />
      ))}
      <Row title="Several people" selected={!typing && chosen === SEVERAL} right={check(SEVERAL)} onPress={() => pick(SEVERAL)} />
      {typing ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          maxLength={SPEAKER_MAX_CHARS}
          placeholder="Name"
          placeholderTextColor={colors.ink4}
          accessibilityLabel="New name"
          returnKeyType="done"
          style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
        />
      ) : (
        <Row title="+ New name" onPress={() => setTyping(true)} />
      )}
      <View style={styles.switchRow}>
        {(
          [
            ["these", "Only these lines"],
            ["until", "Until the next name"],
          ] as const
        ).map(([value, label]) => {
          const active = scope === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setScope(value)}
              style={[styles.switchItem, { backgroundColor: active ? colors.accentSoft : colors.surface2 }]}
            >
              <Text style={[styles.switchText, { color: colors.ink }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Caption>You choose each name. NotePath does not identify people by voice or keep voice data between sessions.</Caption>
      <PrimaryButton
        label="Save name"
        disabled={chosen === null}
        onPress={() => {
          if (chosen !== null) save(chosen);
        }}
      />
      {data.current !== null ? <SecondaryButton label="Remove name" onPress={() => save(null)} /> : null}
      <SecondaryButton label="Cancel" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, gap: 12, paddingBottom: 40 },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, fontSize: 17 },
  switchRow: { flexDirection: "row", gap: 8 },
  switchItem: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  switchText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
});
