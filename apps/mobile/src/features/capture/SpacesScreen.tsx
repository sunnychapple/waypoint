import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsLabel } from "../../core/capture/labels.ts";
import { listSpaces } from "../../core/db/spaces.ts";
import { listGroups, spaceGroups, splitSpaces } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export default function SpacesScreen() {
  const colors = useColors();
  const spaces = useQuery(listSpaces);
  const groups = useQuery(spaceGroups);
  const shared = useQuery((db) => listGroups(db).filter((g) => g.kind === "shared"));
  // A shared space is listed under "Shared spaces" only, so each space appears once.
  const lists = splitSpaces(spaces, groups);
  const empty = lists.private.length === 0 && shared.length === 0;
  return (
    <Screen>
      <View style={styles.header}>
        <Title>Spaces</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New space"
          onPress={() => router.push("/new-space")}
          hitSlop={8}
          style={[styles.add, { backgroundColor: colors.accentSoft }]}
        >
          <SymbolView name="plus" tintColor={colors.accent} size={18} />
        </Pressable>
      </View>
      {empty ? <Caption>No spaces yet. Tap + to make one.</Caption> : null}
      {lists.private.length > 0 ? <Caption>Private</Caption> : null}
      {lists.private.map((space) => (
        <Row
          key={space.id}
          title={space.name}
          subtitle={sessionsLabel(space.sessionCount)}
          leading={
            <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
              <SymbolView name="folder" tintColor={colors.ink} size={22} />
            </View>
          }
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/space/${space.id}`)}
        />
      ))}
      {shared.length > 0 ? <Caption>Shared spaces</Caption> : null}
      {shared.map((group) => (
        <Row
          key={group.id}
          title={group.name === "" ? "Shared space" : group.name}
          subtitle="Shared"
          leading={
            <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
              <SymbolView name="person.2" tintColor={colors.ink} size={22} />
            </View>
          }
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/shared/${encodeURIComponent(group.id)}`)}
        />
      ))}
      <SecondaryButton label="Have an invite? Paste it" icon="link" onPress={() => router.push("/join")} style={styles.paste} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  paste: { alignSelf: "flex-start", marginTop: 16 },
});
