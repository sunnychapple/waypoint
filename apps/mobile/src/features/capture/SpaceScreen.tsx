import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsInSpace } from "../../core/capture/sessions.ts";
import { getSetting } from "../../core/db/settings.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { countLabel, formatClock } from "../../core/format.ts";
import { SYNC_LIMIT_KEY, sendingPaused } from "../../core/sync/limit.ts";
import { useMinuteNow, useQuery } from "../../platform/db.ts";
import { SYNC_PLAN_KEY, isSpaceSynced, turnOnSync } from "../../platform/sync.ts";
import { BackButton, Body, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export default function SpaceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useMinuteNow();
  const data = useQuery(
    (db) => ({
      space: getSpace(db, id),
      sessions: sessionsInSpace(db, id),
      synced: isSpaceSynced(db, id),
      planRequired: getSetting(db, SYNC_PLAN_KEY) === "1",
      limited: sendingPaused(getSetting(db, SYNC_LIMIT_KEY), now),
    }),
    `${id}:${now}`,
  );
  const name = data.space?.name ?? "";
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const startSync = () => {
    setBusy(true);
    setFailed(false);
    turnOnSync(id)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <BackButton />
      <Title>{name}</Title>
      <Row
        title="Sync with my other devices"
        right={<Switch value={data.synced} disabled={data.synced || busy} onValueChange={startSync} />}
      />
      {data.synced && data.planRequired ? <Body>Photos and audio sync on paid plans.</Body> : null}
      {data.synced && data.limited ? (
        <>
          <Body>Today's sync is used up. Changes wait on this iPhone.</Body>
          <SecondaryButton label="Add more for today" icon="arrow.up.circle" onPress={() => router.push("/sync-limit")} />
        </>
      ) : null}
      {failed ? <Body>Couldn't start sync. Try again.</Body> : null}
      {data.sessions.length === 0 ? (
        <Body>Nothing here yet. Things you save to {name} show up here.</Body>
      ) : (
        data.sessions.map((s) => {
          const date = new Date(s.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const detail = s.kind === "recording" ? formatClock(s.recordedMs) : countLabel(s.pages, "page", "pages");
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
