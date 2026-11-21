import { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { listPages, removePage, wordCount } from "../../core/capture/pages.ts";
import { deleteSessionRow, getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { countLabel } from "../../core/format.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { deleteFile, deleteSessionFiles, fileUri } from "../../platform/files.ts";
import { getAvailability } from "../../../modules/waypoint-model/index.ts";
import { Caption, OnDeviceNote, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { PageSheet } from "./PageSheet.tsx";

const GAP = 8;
const COLUMNS = 4;

// Your pages: the pages of one session, with add, remove, move, and what to make from them.
export default function YourPagesScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery((db) => {
    const session = getSession(db, id);
    if (!session) return null;
    return { spaceName: getSpace(db, session.spaceId)?.name ?? "", pages: listPages(db, id) };
  }, id);
  const [openId, setOpenId] = useState<string | null>(null);
  // "· free" only where the study sets are made on this iPhone; elsewhere they are not free to make.
  const [onDevice] = useState(() => getAvailability() === "available");
  const free = onDevice ? " · free" : "";
  const cell = (width - 40 - GAP * (COLUMNS - 1)) / COLUMNS;

  if (!data) return <Screen>{null}</Screen>;
  const { pages, spaceName } = data;
  const words = wordCount(pages.map((p) => p.foundText));
  const reading = pages.some((p) => p.foundText === null);
  const opened = pages.find((p) => p.id === openId) ?? null;
  // Pages whose read found no words: the first one is where the line below opens.
  const blankPages = pages.filter((p) => p.foundText !== null && p.foundText.trim() === "");

  function remove(captureId: string) {
    const file = writeDb((db) => removePage(db, captureId));
    deleteFile(file);
  }

  // The × sits on the thumbnail, so a missed tap must not delete a page straight away.
  function confirmRemove(captureId: string, index: number) {
    Alert.alert(`Remove page ${index + 1}?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(captureId) },
    ]);
  }

  function discard() {
    writeDb((db) => deleteSessionRow(db, id));
    deleteSessionFiles(id);
    router.replace("/");
  }

  function confirmDiscard() {
    Alert.alert(pages.length === 1 ? "Delete this page?" : `Delete ${pages.length} pages?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: discard },
    ]);
  }

  // Pages can come from the document camera or from the photos already on the phone.
  function openAddMenu() {
    Alert.alert("Add pages", undefined, [
      { text: "Take photos", onPress: () => router.push(`/pages/new?sessionId=${id}`) },
      { text: "From Photos", onPress: () => router.push(`/pages/new?sessionId=${id}&from=photos`) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function openMenu() {
    Alert.alert("Your pages", undefined, [
      { text: "Delete these pages", style: "destructive", onPress: confirmDiscard },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <Screen>
      <View style={styles.topRow}>
        <CircleButton label="Back" icon="chevron.left" onPress={() => router.back()} />
        <CircleButton label="More" icon="ellipsis" onPress={openMenu} />
      </View>
      <Title>Your pages</Title>
      <Caption>
        {reading ? `${countLabel(pages.length, "page", "pages")} · reading on this iPhone…` : `${countLabel(pages.length, "page", "pages")} · ${words} words read on this iPhone`}
      </Caption>
      {blankPages.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/session/${id}?page=${blankPages[0]?.id ?? ""}`)}
          style={styles.blankLine}
        >
          <Text style={[styles.blankText, { color: colors.accent }]}>Couldn't read {countLabel(blankPages.length, "page", "pages")}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Saving to ${spaceName}`}
        onPress={() => router.push(`/space-picker?sessionId=${id}`)}
        style={styles.pillRow}
      >
        <Caption>Saving to</Caption>
        <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.lineStrong }]}>
          <SymbolView name="folder" tintColor={colors.accent} size={18} />
          <Text style={[styles.pillText, { color: colors.ink }]}>{spaceName}</Text>
          <SymbolView name="chevron.down" tintColor={colors.ink3} size={12} />
        </View>
      </Pressable>

      <View style={styles.grid}>
        {pages.map((page, index) => (
          <View key={page.id} style={{ width: cell, aspectRatio: 0.75 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Page ${index + 1}`}
              onPress={() => setOpenId(page.id)}
              style={[styles.thumb, { backgroundColor: colors.surface, borderColor: colors.line }]}
            >
              <Image source={{ uri: fileUri(page.file) }} resizeMode="cover" style={styles.thumbImage} />
            </Pressable>
            <View style={[styles.number, { backgroundColor: colors.surface }]}>
              <Text style={[styles.numberText, { color: colors.ink2 }]}>{index + 1}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove page ${index + 1}`}
              onPress={() => confirmRemove(page.id, index)}
              hitSlop={11}
              style={[styles.removeBadge, { backgroundColor: colors.ink }]}
            >
              <SymbolView name="xmark" tintColor={colors.bg} size={10} />
            </Pressable>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add pages"
          onPress={openAddMenu}
          style={[styles.addTile, { width: cell, aspectRatio: 0.75, backgroundColor: colors.accentSoft }]}
        >
          <SymbolView name="camera" tintColor={colors.accent} size={24} />
          <Text style={[styles.addText, { color: colors.accent }]}>Add</Text>
        </Pressable>
      </View>

      <Caption style={styles.section}>MAKE SOMETHING FROM THESE</Caption>
      <View style={[styles.list, { borderColor: colors.line }]}>
        <Row
          title="Help me with a problem"
          subtitle="Tap any problem. Steps first, answer last."
          leading={<Leading icon="questionmark.circle" />}
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/study/help?sessionId=${id}`)}
        />
        <Row
          title="Flashcards"
          subtitle={`About ${Math.min(12, Math.max(3, Math.round(words / 40)))} cards${free}`}
          leading={<Leading icon="square.stack.3d.up" />}
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/study/make?sessionId=${id}`)}
        />
        <Row
          title="Quiz me"
          subtitle={`5 questions${free}`}
          leading={<Leading icon="checklist" />}
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/study/quiz?sessionId=${id}`)}
        />
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Just save the pages" onPress={() => router.push(`/session/${id}`)} style={styles.save}>
        <Text style={[styles.saveText, { color: colors.accent }]}>Just save the pages</Text>
      </Pressable>
      <View style={styles.footer}>
        <OnDeviceNote text="Pages are read on this iPhone." />
      </View>

      <PageSheet
        page={opened}
        count={pages.length}
        onClose={() => setOpenId(null)}
      />
    </Screen>
  );
}

function Leading({ icon }: { icon: SFSymbol }) {
  const colors = useColors();
  return (
    <View style={[styles.leading, { backgroundColor: colors.surface2 }]}>
      <SymbolView name={icon} tintColor={colors.ink} size={22} />
    </View>
  );
}

function CircleButton({ label, icon, onPress }: { label: string; icon: SFSymbol; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name={icon} tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  blankLine: { alignSelf: "flex-start" },
  blankText: { fontSize: 15, fontWeight: "600" },
  pillRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 17, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  thumb: { flex: 1, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  thumbImage: { width: "100%", height: "100%" },
  number: {
    position: "absolute",
    left: 6,
    top: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  numberText: { fontSize: 13, fontWeight: "600" },
  removeBadge: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: { borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontSize: 15, fontWeight: "600" },
  section: { letterSpacing: 1, marginTop: 8 },
  list: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  leading: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  save: { alignSelf: "center", paddingVertical: 12 },
  saveText: { fontSize: 17, fontWeight: "600" },
  footer: { alignItems: "center" },
});
