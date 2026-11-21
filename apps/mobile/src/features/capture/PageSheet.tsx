import { Alert, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { movePage, removePage } from "../../core/capture/pages.ts";
import { writeDb } from "../../platform/db.ts";
import { deleteFile, fileUri } from "../../platform/files.ts";
import { SecondaryButton } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export type SheetPage = { id: string; file: string; position: number };

// The full page, with moves and removal. Shown as a page sheet from "Your pages".
export function PageSheet({
  page,
  count,
  onClose,
}: {
  page: SheetPage | null;
  count: number;
  onClose: () => void;
}) {
  const colors = useColors();
  const { height } = useWindowDimensions();

  function move(toPosition: number) {
    if (!page) return;
    writeDb((db) => movePage(db, page.id, toPosition));
  }

  function remove() {
    if (!page) return;
    const file = writeDb((db) => removePage(db, page.id));
    deleteFile(file);
    onClose();
  }

  // Removing is the one thing here that can't be undone, so it asks first, as the thumbnail × does.
  function confirmRemove() {
    if (!page) return;
    Alert.alert("Remove this page?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: remove },
    ]);
  }

  return (
    <Modal visible={page !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {page ? (
        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={styles.topRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} hitSlop={10}>
              <Text style={[styles.done, { color: colors.accent }]}>Done</Text>
            </Pressable>
          </View>
          <Image
            accessibilityLabel={`Page ${page.position + 1}`}
            source={{ uri: fileUri(page.file) }}
            resizeMode="contain"
            style={[styles.image, { height: height * 0.6, backgroundColor: colors.surface2 }]}
          />
          <View style={styles.actions}>
            <SecondaryButton
              label="Move earlier"
              icon="arrow.up"
              style={[styles.half, page.position === 0 ? styles.disabled : null]}
              onPress={() => move(page.position - 1)}
            />
            <SecondaryButton
              label="Move later"
              icon="arrow.down"
              style={[styles.half, page.position >= count - 1 ? styles.disabled : null]}
              onPress={() => move(page.position + 1)}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove page"
            onPress={confirmRemove}
            style={[styles.remove, { backgroundColor: colors.dangerSoft }]}
          >
            <Text style={[styles.removeText, { color: colors.danger }]}>Remove page</Text>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 20, gap: 16 },
  topRow: { flexDirection: "row", justifyContent: "flex-end" },
  done: { fontSize: 17, fontWeight: "600" },
  image: { width: "100%", borderRadius: 12 },
  actions: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
  disabled: { opacity: 0.4 },
  remove: { minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 17, fontWeight: "600" },
});
