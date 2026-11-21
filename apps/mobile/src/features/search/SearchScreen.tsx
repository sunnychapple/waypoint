import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { latestSession } from "../../core/capture/sessions.ts";
import { formatOffset } from "../../core/format.ts";
import { indexStatus } from "../../core/search/indexer.ts";
import { searchNotes, type Hit } from "../../core/search/query.ts";
import { embed, getModel } from "../../../modules/waypoint-embed/index.ts";
import { getDb, useQuery } from "../../platform/db.ts";
import { Caption, OnDeviceNote, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const DEBOUNCE_MS = 250;

// Where a hit opens: its moment in the session, and for a page or photo hit (captureId set) that capture, so the
// session can land on that page rather than the top.
export function hitRoute(hit: Pick<Hit, "sessionId" | "tStart" | "captureId">): string {
  const page = hit.captureId === null ? "" : `&page=${encodeURIComponent(hit.captureId)}`;
  return `/session/${hit.sessionId}?t=${hit.tStart}${page}`;
}

// Splits a snippet on its [bracketed] words, which are the keyword matches.
function Snippet({ text }: { text: string }) {
  const colors = useColors();
  const parts = text.split(/(\[[^\]]*\])/);
  return (
    <Text style={[styles.snippet, { color: colors.ink2 }]}>
      {parts.map((part, i) =>
        part.startsWith("[") && part.endsWith("]") ? (
          <Text key={i} style={[styles.bold, { color: colors.ink }]}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function HitRow({ hit, onPress }: { hit: Hit; onPress: () => void }) {
  const colors = useColors();
  const where = hit.captureId === null ? formatOffset(hit.tStart) : "Page";
  const label = `${hit.sessionTitle}, ${hit.spaceName}, ${where}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <View style={styles.rowHead}>
        <Text style={[styles.rowTitle, { color: colors.ink }]} numberOfLines={1}>
          {hit.sessionTitle}
        </Text>
        <Caption>{where}</Caption>
      </View>
      <Caption>{hit.spaceName}</Caption>
      <Snippet text={hit.snippet} />
    </Pressable>
  );
}

export default function SearchScreen() {
  const colors = useColors();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; hits: Hit[] } | null>(null);
  const latest = useQuery(latestSession);
  // A finished index run changes these counts, which re-runs the search below. Other writes do not.
  const index = useQuery((db) => indexStatus(db, getModel().modelVersion));
  const { chunks, vectors } = index;
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (query === "") {
      setResults(null);
      return;
    }
    const id = ++requestId.current;
    // Without the on-device model there are no meaning vectors; keyword search still runs.
    const model = getModel();
    const embedder = {
      modelVersion: model.modelVersion,
      embed: (texts: string[]): Promise<number[][]> =>
        model.available ? embed(texts) : Promise.resolve(texts.map((): number[] => [])),
    };
    searchNotes(getDb(), embedder, query, {})
      .then((hits) => {
        if (id === requestId.current) setResults({ query, hits });
      })
      .catch(() => {
        if (id === requestId.current) setResults({ query, hits: [] });
      });
  }, [query, chunks, vectors]);

  const empty = text.trim() === "" && latest === null;
  const current = results !== null && results.query === query ? results : null;

  return (
    <Screen>
      <Title>Search</Title>
      <TextInput
        accessibilityLabel="Search your notes"
        placeholder="Search your notes"
        placeholderTextColor={colors.ink3}
        value={text}
        onChangeText={setText}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={[styles.field, { backgroundColor: colors.surface2, color: colors.ink }]}
      />

      {empty ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
            <SymbolView name="magnifyingglass" tintColor={colors.ink3} size={32} />
          </View>
          <Title style={styles.centered}>Find anything you recorded or snapped</Title>
          <Caption style={styles.centered}>Record something or snap a page first, then find it here.</Caption>
        </View>
      ) : null}

      {current && current.hits.length === 0 ? (
        <Caption style={styles.centered}>{`Nothing found for “${current.query}”.`}</Caption>
      ) : null}

      {current
        ? current.hits.map((hit) => (
            <HitRow
              key={`${hit.chunkId}`}
              hit={hit}
              onPress={() => router.push(hitRoute(hit))}
            />
          ))
        : null}

      <OnDeviceNote text="Search runs on this iPhone." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  empty: { alignItems: "center", gap: 12, paddingTop: 64 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  centered: { textAlign: "center" },
  row: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: "600" },
  snippet: { fontSize: 15, lineHeight: 21 },
  bold: { fontWeight: "700" },
});
