import { useState } from "react";
import { Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { sessionLinks, sessionMedia, type MediaItem, type SessionLink } from "../../core/capture/media.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { formatOffset } from "../../core/format.ts";
import { useStableQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { BackButton, Caption, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Filter = "all" | "photos" | "pages" | "links";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "photos", label: "Photos" },
  { key: "pages", label: "Pages" },
  { key: "links", label: "Links" },
];
const COLUMNS = 3;
const GAP = 8;
const PADDING = 20;

// S9: everything from one session, like details in Messages. A photo or page goes back to its moment in the session; a link
// opens in the browser only when tapped.
export default function MediaScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Stable: a write during a recording (a new line) does not redraw this grid unless the photos, pages or links change.
  const data = useStableQuery((db) => ({ title: getSession(db, id)?.title ?? "", media: sessionMedia(db, id), links: sessionLinks(db, id) }), id);
  const [filter, setFilter] = useState<Filter>("all");
  const media = data.media.filter((item) => filter === "all" || (filter === "photos" ? item.kind === "photo" : filter === "pages" && item.kind === "page"));
  const links = filter === "all" || filter === "links" ? data.links : [];
  // A fixed thumbnail size from the screen width: the grid never decodes a photo at full size.
  const thumb = Math.floor((width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  // Back to the session screen under this one, at the moment (see SessionScreen's t and page params). The changing n makes
  // each jump new, so the same photo or page lands again.
  function jump(item: MediaItem): void {
    const query = item.kind === "page" ? `page=${encodeURIComponent(item.id)}` : `t=${item.t}`;
    router.dismissTo(`/session/${encodeURIComponent(id)}?${query}&n=${Date.now()}`);
  }

  function open(link: SessionLink): void {
    Linking.openURL(link.url).catch(() => Alert.alert("Couldn't open that link"));
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <BackButton />
      </View>
      <Caption numberOfLines={1}>{data.title}</Caption>
      <Title>Media</Title>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, { backgroundColor: filter === f.key ? colors.accentSoft : colors.surface2 }]}
          >
            <Text style={[styles.filterText, { color: colors.ink }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {media.length > 0 ? <Caption>Photos and pages</Caption> : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {media.length === 0 && links.length === 0 ? (
        <Caption>Nothing here yet. Photos, pages and links from this session show up here.</Caption>
      ) : null}
      {links.length > 0 ? (
        <>
          <Caption>Links</Caption>
          {links.map((link) => (
            <Pressable
              key={link.url}
              accessibilityRole="button"
              accessibilityLabel={`Open ${link.host} in the browser`}
              onPress={() => open(link)}
              style={[styles.link, { backgroundColor: colors.surface, borderColor: colors.line }]}
            >
              <Text style={[styles.linkHost, { color: colors.ink }]} numberOfLines={1}>
                {link.host}
              </Text>
              <Text style={[styles.linkWhere, { color: colors.ink3 }]}>{whereLabel(link)}</Text>
            </Pressable>
          ))}
          <Caption>Links come from your pages and transcript. Nothing opens until you tap it.</Caption>
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <FlatList
        data={media}
        numColumns={COLUMNS}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={5}
        removeClippedSubviews
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${mediaLabel(item)}, go to this moment`}
            onPress={() => jump(item)}
            style={[styles.tile, { width: thumb }]}
          >
            {item.file === "" ? (
              <View style={[styles.thumb, { width: thumb, height: thumb, backgroundColor: colors.surface2 }]} />
            ) : (
              <Image
                source={{ uri: fileUri(item.file) }}
                resizeMode="cover"
                resizeMethod="resize"
                style={[styles.thumb, { width: thumb, height: thumb, backgroundColor: colors.surface2 }]}
              />
            )}
            <Text style={[styles.tileText, { color: colors.ink3 }]}>{mediaLabel(item)}</Text>
          </Pressable>
        )}
        style={styles.list}
      />
    </SafeAreaView>
  );
}

// "Photo · 31:40" or "Page 3".
function mediaLabel(item: MediaItem): string {
  return item.kind === "page" ? `Page ${item.page ?? 1}` : `Photo · ${formatOffset(item.t)}`;
}

function whereLabel(link: SessionLink): string {
  return link.page !== null ? `Page ${link.page}` : formatOffset(link.t ?? 0);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { flex: 1 },
  content: { padding: PADDING, paddingBottom: 40, gap: GAP },
  header: { gap: 16, paddingBottom: 8 },
  footer: { gap: 12, paddingTop: 8 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  filters: { flexDirection: "row", gap: 8 },
  filter: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 15, fontWeight: "600" },
  tile: { gap: 4, marginBottom: GAP },
  thumb: { borderRadius: 10 },
  tileText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  link: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkHost: { flex: 1, fontSize: 16, fontWeight: "600" },
  linkWhere: { fontSize: 15, fontVariant: ["tabular-nums"] },
});
