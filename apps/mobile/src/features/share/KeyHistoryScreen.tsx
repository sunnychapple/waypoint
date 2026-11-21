import { StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getGroup, heldVersions } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { BackButton, Caption, Row, Screen, Title } from "../../ui/kit.tsx";

// The periods this iPhone has held a group's key versions for, with the day each was learned (M30b). Each period
// starts on the day its version was learned and ends where the next one starts.
export default function KeyHistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const data = useQuery((db) => {
    const group = getGroup(db, groupId);
    return group === null ? null : { name: group.name, current: group.keyVersion, held: heldVersions(db, groupId) };
  }, groupId);
  if (!data) return <Screen>{null}</Screen>;
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  // held is oldest first.
  const periods = data.held.map((version, i) => {
    const next = data.held[i + 1];
    const title =
      version.keyVersion === data.current
        ? `Since ${day(version.learnedAt)}: everyone here now`
        : next !== undefined
          ? `${day(version.learnedAt)} to ${day(next.learnedAt)}`
          : `Since ${day(version.learnedAt)}`;
    return { keyVersion: version.keyVersion, title };
  });
  return (
    <Screen>
      <BackButton />
      <Title>{data.name || "Who can see these notes"}</Title>
      <Caption style={styles.caption}>
        When someone leaves or is removed, new notes are locked so they can't see them. They keep what they already saw.
      </Caption>
      {[...periods].reverse().map((period) => (
        <Row key={period.keyVersion} title={period.title} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  caption: { marginBottom: 8 },
});
