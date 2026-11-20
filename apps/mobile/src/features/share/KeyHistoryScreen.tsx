import { StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getGroup, heldVersions } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, Row, Screen, Title } from "../../ui/kit.tsx";

// The group's key versions this iPhone holds, with the day each was learned (M30b).
export default function KeyHistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const data = useQuery((db) => {
    const group = getGroup(db, groupId);
    return group === null ? null : { name: group.name, current: group.keyVersion, held: heldVersions(db, groupId) };
  }, groupId);
  if (!data) return <Screen>{null}</Screen>;
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <Screen>
      <Title>{data.name || "Key history"}</Title>
      <Caption style={styles.caption}>
        A new key starts when someone leaves or is removed, so they cannot read what comes after.
      </Caption>
      <Row title={`Current: key ${data.current}`} />
      {[...data.held].reverse().map((version) => (
        <Row key={version.keyVersion} title={`Key ${version.keyVersion} · since ${day(version.learnedAt)}`} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  caption: { marginBottom: 8 },
});
