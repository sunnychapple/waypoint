import { useState } from "react";
import { KeyboardAvoidingView, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { editPageText, nameUntitledPages } from "../../core/capture/pages.ts";
import { writeDb } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { Caption } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Types or fixes the text of one page, as a page sheet. The page image stays above the text to check against.
export function PageTextEditor({
  captureId,
  file,
  number,
  text,
  onClose,
}: {
  captureId: string;
  file: string;
  number: number;
  text: string | null;
  onClose: () => void;
}) {
  const colors = useColors();
  // The parent mounts this only while it is open, so the draft starts from the text each time.
  const [draft, setDraft] = useState(text ?? "");

  function save() {
    writeDb((db) => {
      editPageText(db, captureId, draft);
      nameUntitledPages(db);
    });
    onClose();
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.sheet, { backgroundColor: colors.bg }]}>
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: colors.ink2 }]}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save" onPress={save} hitSlop={10}>
            <Text style={[styles.action, { color: colors.accent }]}>Save</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <Image
            accessibilityLabel={`Page ${number}`}
            source={{ uri: fileUri(file) }}
            resizeMode="contain"
            style={[styles.image, { backgroundColor: colors.surface2 }]}
          />
          <Caption>New flashcards and quizzes will use this text.</Caption>
          <TextInput
            accessibilityLabel={`Text of page ${number}`}
            multiline
            value={draft}
            onChangeText={setDraft}
            textAlignVertical="top"
            style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 20, gap: 16 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  action: { fontSize: 17, fontWeight: "600" },
  body: { gap: 12, paddingBottom: 24 },
  image: { width: "100%", aspectRatio: 0.75, borderRadius: 12 },
  input: { minHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 17, lineHeight: 24 },
});
