import { useState } from "react";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { sessionLinks, sessionMedia, type MediaItem, type SessionLink } from "../../core/capture/media.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { formatOffset } from "../../core/format.ts";
import { openableUrl } from "../../core/research/answer.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { BackButton, Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Filter = "all" | "photos" | "pages" | "links";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "photos", label: "Photos" },
  { key: "pages", label: "Pages" },
  { key: "links", label: "Links" },
];

// S9: everything from one session, like details in Messages. A photo or page goes back to its moment in the session; a link
// opens in the browser only when tapped.
export default function MediaScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery((db) => ({ title: getSession(db, id)?.title ?? "", media: sessionMedia(db, id), links: sessionLinks(db, id) }), id);
  const [filter, setFilter] = useState<Filter>("all");
  const media = data.media.filter((item) => filter === "all" || (filter === "photos" ? item.kind === "photo" : filter === "pages" && item.kind === "page"));
  const links = filter === "all" || filter === "links" ? data.links : [];

  // Back to the session screen under this one, at the moment (see SessionScreen's t and page params).
  function jump(where: { t: number | null; captureId: string | null; kind: "photo" | "page" | "link" }): void {
    const query = where.kind === "page" && where.captureId !== null ? `page=${encodeURIComponent(where.captureId)}` : `t=${where.t ?? 0}`;
    router.dismissTo(`/session/${encodeURIComponent(id)}?${query}`);
  }

  function open(link: SessionLink): void {
    const url = openableUrl(link.url);
    if (url === null) return;
    Linking.openURL(url).catch(() => Alert.alert("Couldn't open that link"));
  }

  return (
    <Screen>
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

      {media.length === 0 && links.length === 0 ? <Caption>Nothing here yet. Photos, pages and links from this session show up here.</Caption> : null}

      {media.length > 0 ? (
        <>
          <Caption>Photos and pages</Caption>
          <View style={styles.grid}>
            {media.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${mediaLabel(item)}, go to this moment`}
                onPress={() => jump({ t: item.t, captureId: item.id, kind: item.kind })}
                style={styles.tile}
              >
                {item.file === "" ? (
                  <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
                ) : (
                  <Image source={{ uri: fileUri(item.file) }} resizeMode="cover" style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
                )}
                <Text style={[styles.tileText, { color: colors.ink3 }]}>{mediaLabel(item)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {links.length > 0 ? (
        <>
          <Caption>Links</Caption>
          {links.map((link) => (
            <Row
              key={link.url}
              title={link.host}
              {...(link.shown === link.host ? {} : { subtitle: link.shown })}
              onPress={() => open(link)}
              right={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${whereLabel(link)}`}
                  onPress={() => jump({ t: link.t, captureId: link.captureId, kind: link.page !== null ? "page" : "link" })}
                  style={styles.when}
                >
                  <Text style={[styles.whenText, { color: colors.accent }]}>{whereLabel(link)}</Text>
                </Pressable>
              }
            />
          ))}
          <Caption>Links come from your pages and transcript. Nothing opens until you tap it.</Caption>
        </>
      ) : null}
    </Screen>
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
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  filters: { flexDirection: "row", gap: 8 },
  filter: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 15, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31%", gap: 4 },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 10 },
  tileText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  when: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  whenText: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
