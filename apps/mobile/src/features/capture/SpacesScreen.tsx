import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsLabel } from "../../core/capture/labels.ts";
import { listSpaces } from "../../core/db/spaces.ts";
import { listGroups } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export default function SpacesScreen() {
  const colors = useColors();
  const spaces = useQuery(listSpaces);
  const shared = useQuery((db) => listGroups(db).filter((g) => g.kind === "shared"));
  return (
    <Screen>
      <Title>Spaces</Title>
      {spaces.map((space) => (
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
      <Caption>Shared spaces</Caption>
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
      <SecondaryButton label="New shared space" icon="person.2" onPress={() => router.push("/shared/new")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
