import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { addNote, deleteNote, getNote, NOTE_MAX_CHARS, QUOTE_MAX_CHARS, updateNote } from "../../core/capture/notes.ts";
import { formatOffset } from "../../core/format.ts";
import { dbGeneration, getDb, writeDbIf } from "../../platform/db.ts";
import { Caption, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now, newId: randomUUID };

// A note in a recording's timeline (note 13). New from the Note button or from selected words, or opened from the
// timeline to change or delete. The recording keeps running under this sheet.
export default function NoteSheet() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string; sessionId?: string; t?: string; quote?: string }>();
  const [generation] = useState(dbGeneration);
  const asked = params.id !== undefined && params.id !== "";
  const [existing] = useState(() => (asked && params.id !== undefined ? getNote(getDb(), params.id) : null));
  const [draft, setDraft] = useState(existing?.text ?? "");
  const sessionId = existing?.sessionId ?? params.sessionId ?? "";
  const t = existing?.t ?? (params.t === undefined || params.t === "" ? Number.NaN : Number(params.t));
  const quote = existing?.quote ?? (params.quote ?? "").slice(0, QUOTE_MAX_CHARS);
  const missing = (asked && existing === null) || sessionId === "" || !Number.isFinite(t);

  // The same confirmation for Delete and for saving an emptied note (which deletes it).
  function confirmDelete(): void {
    if (existing === null) return;
    Alert.alert("Delete this note?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          writeDbIf(generation, (db) => deleteNote(db, existing.id));
          router.back();
        },
      },
    ]);
  }

  function save(): void {
    if (existing !== null && draft.trim() === "") {
      confirmDelete();
      return;
    }
    let saved: true | undefined;
    try {
      saved = writeDbIf(generation, (db) => {
        if (existing !== null) updateNote(db, existing.id, draft);
        else addNote(db, deps, sessionId, t, draft, quote);
        return true as const;
      });
    } catch {
      Alert.alert("Couldn't save this note.", "The recording may have been removed.");
      return;
    }
    // undefined: the account changed since the sheet opened, so nothing was written. Keep the sheet open.
    if (saved === undefined) {
      Alert.alert("Couldn't save the note.");
      return;
    }
    router.back();
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.sheet, { backgroundColor: colors.bg }]}>
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10} onPress={() => router.back()} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.ink2 }]}>Cancel</Text>
        </Pressable>
        {missing ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Save note" hitSlop={10} onPress={save} style={styles.action}>
            <Text style={[styles.actionText, { color: colors.accent }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Title>Note</Title>
        <Caption>{missing ? "This note isn't here any more." : `At ${formatOffset(t)}`}</Caption>
        {quote !== "" ? <Text style={[styles.quote, { color: colors.ink2, borderLeftColor: colors.accent }]}>{`“${quote}”`}</Text> : null}
        {missing ? null : (
          <TextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={setDraft}
            maxLength={NOTE_MAX_CHARS}
            placeholder="Type your note"
            placeholderTextColor={colors.ink4}
            accessibilityLabel="Note"
            textAlignVertical="top"
            style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
          />
        )}
        {existing !== null ? (
          <Pressable accessibilityRole="button" onPress={confirmDelete} style={styles.action}>
            <Text style={[styles.actionText, { color: colors.danger }]}>Delete note</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 20, gap: 12 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  action: { minHeight: 44, justifyContent: "center" },
  actionText: { fontSize: 17, fontWeight: "600" },
  body: { gap: 12, paddingBottom: 24 },
  quote: { fontSize: 15, fontStyle: "italic", borderLeftWidth: 3, paddingLeft: 10 },
  input: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 17, lineHeight: 24 },
});
