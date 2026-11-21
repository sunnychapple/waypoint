import { Alert, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsLabel, usedLabel } from "../../core/capture/labels.ts";
import { getSession, moveSession } from "../../core/capture/sessions.ts";
import { getSavingTo, listSpaces, setSavingTo } from "../../core/db/spaces.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { markMoved } from "../../core/sync/changes.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { Caption, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Opened from the "Saving to" pill, or from a session with ?sessionId= (then only that session moves).
export default function SpacePickerScreen() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const all = useQuery(listSpaces);
  const groups = useQuery(spaceGroups);
  const currentId = useQuery((db) => (sessionId ? (getSession(db, sessionId)?.spaceId ?? null) : getSavingTo(db).id), sessionId ?? "");
  const offset = -new Date().getTimezoneOffset();
  // A viewer cannot add to a shared space (the server refuses their changes), so it is not offered.
  const spaces = all.filter((space) => groups.get(space.id)?.role !== "viewer" || space.id === currentId);
  const nameOf = (id: string | null) => all.find((space) => space.id === id)?.name ?? "the shared space";

  // Moving a session into or out of a shared space is confirmed: everyone there gains or loses it (M30b).
  function choose(spaceId: string) {
    const into = groups.get(spaceId)?.kind === "shared";
    const outOf = currentId !== null && groups.get(currentId)?.kind === "shared";
    if (!sessionId || spaceId === currentId || (!into && !outOf)) return move(spaceId);
    const lines = [
      outOf ? `It will be removed for everyone in ${nameOf(currentId)}.` : null,
      into ? `Everyone in ${nameOf(spaceId)} will see this session.` : null,
    ];
    Alert.alert("Move this session?", lines.filter((line) => line !== null).join(" "), [
      { text: "Cancel", style: "cancel" },
      { text: "Move", onPress: () => move(spaceId) },
    ]);
  }

  function move(spaceId: string) {
    writeDb((db) => {
      if (sessionId) {
        // A move to another space: the rows follow the new space's group, and the old group drops the session (M30b).
        const from = getSession(db, sessionId)?.spaceId ?? null;
        const oldGroup = from === null ? null : (db.get<{ group_id: string }>("SELECT group_id FROM space_groups WHERE space_id = ?", [from])?.group_id ?? null);
        moveSession(db, sessionId, spaceId, Date.now());
        if (from !== spaceId) markMoved(db, sessionId, oldGroup);
      } else setSavingTo(db, spaceId, Date.now());
    });
    router.back();
  }

  return (
    <Screen>
      <Title>Where should this go?</Title>
      {spaces.map((space) => {
        const parts = space.isDefault
          ? ["Everything not in a space yet"]
          : [groups.get(space.id)?.kind === "shared" ? "Shared" : null, usedLabel(space.lastUsedAt, Date.now(), offset), sessionsLabel(space.sessionCount)];
        return (
          <Row
            key={space.id}
            title={space.name}
            subtitle={parts.filter((p): p is string => p !== null).join(" · ")}
            leading={
              <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
                <SymbolView name="folder" tintColor={colors.ink} size={22} />
              </View>
            }
            right={space.id === currentId ? <SymbolView name="checkmark" tintColor={colors.accent} size={18} /> : null}
            selected={space.id === currentId}
            onPress={() => choose(space.id)}
          />
        );
      })}
      <SecondaryButton label="New space" icon="plus" tone="accent" onPress={() => router.push("/new-space?from=picker")} />
      <Caption style={styles.footer}>Not sure? Leave it in My notes. You can move it any time.</Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  footer: { textAlign: "center" },
});
