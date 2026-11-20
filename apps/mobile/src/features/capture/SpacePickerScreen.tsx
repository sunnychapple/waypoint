import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsLabel, usedLabel } from "../../core/capture/labels.ts";
import { getSession, moveSession } from "../../core/capture/sessions.ts";
import { getSavingTo, listSpaces, setSavingTo } from "../../core/db/spaces.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { Caption, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Opened from the "Saving to" pill, or from a session with ?sessionId= (then only that session moves).
export default function SpacePickerScreen() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const spaces = useQuery(listSpaces);
  const currentId = useQuery((db) => (sessionId ? (getSession(db, sessionId)?.spaceId ?? null) : getSavingTo(db).id));
  const offset = -new Date().getTimezoneOffset();

  function choose(spaceId: string) {
    writeDb((db) => {
      if (sessionId) moveSession(db, sessionId, spaceId, Date.now());
      else setSavingTo(db, spaceId, Date.now());
    });
    router.back();
  }

  return (
    <Screen>
      <Title>Where should this go?</Title>
      {spaces.map((space) => {
        const parts = space.isDefault
          ? ["Everything not in a space yet"]
          : [usedLabel(space.lastUsedAt, Date.now(), offset), sessionsLabel(space.sessionCount)];
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
      <SecondaryButton label="New space" icon="plus" tone="accent" onPress={() => router.push("/new-space")} />
      <Caption style={styles.footer}>Not sure? Leave it in My notes. You can move it any time.</Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  footer: { textAlign: "center" },
});
