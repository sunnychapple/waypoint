import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { editSummary, SUMMARY_EDIT_MAX_CHARS } from "../../core/capture/summary.ts";
import { writeDb } from "../../platform/db.ts";
import { Body, Caption } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// S8: the summary under a recording's title. Once the person edits it, the app never replaces it.
export function SummaryCard({ sessionId, text, editable }: { sessionId: string; text: string; editable: boolean }) {
  const colors = useColors();
  const [draft, setDraft] = useState<string | null>(null);

  function save(): void {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== text) writeDb((db) => editSummary(db, sessionId, draft));
    setDraft(null);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.head}>
        <Caption>Summary</Caption>
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft === null ? "Edit summary" : "Save summary"}
            onPress={draft === null ? () => setDraft(text) : save}
            style={styles.touch}
          >
            <Text style={[styles.link, { color: colors.accent }]}>{draft === null ? "Edit" : "Save"}</Text>
          </Pressable>
        ) : null}
      </View>
      {draft === null ? (
        <Body>{text}</Body>
      ) : (
        <TextInput
          autoFocus
          multiline
          accessibilityLabel="Summary"
          value={draft}
          onChangeText={setDraft}
          maxLength={SUMMARY_EDIT_MAX_CHARS}
          style={[styles.input, { color: colors.ink }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  touch: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  link: { fontSize: 15, fontWeight: "600" },
  input: { fontSize: 17, lineHeight: 24, padding: 0, minHeight: 72 },
});
