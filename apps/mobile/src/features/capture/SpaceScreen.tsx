import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsInSpace } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { formatClock } from "../../core/format.ts";
import { useQuery } from "../../platform/db.ts";
import { Body, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export default function SpaceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery((db) => ({ space: getSpace(db, id), sessions: sessionsInSpace(db, id) }));
  const name = data.space?.name ?? "";

  return (
    <Screen>
      <Title>{name}</Title>
      {data.sessions.length === 0 ? (
        <Body>Nothing here yet. Things you save to {name} show up here.</Body>
      ) : (
        data.sessions.map((s) => {
          const date = new Date(s.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const detail = s.kind === "recording" ? formatClock(s.recordedMs) : `${s.pages} pages`;
          return (
            <Row
              key={s.id}
              title={s.title}
              subtitle={`${date} · ${detail}`}
              leading={
                <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
                  <SymbolView name={s.kind === "recording" ? "mic.fill" : "doc.text"} tintColor={colors.ink} size={20} />
                </View>
              }
              onPress={() => router.push(`/session/${s.id}`)}
            />
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
