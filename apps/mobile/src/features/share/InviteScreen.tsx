import { useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { inviteEnds, canInvite, type InviteAccess } from "../../core/share/spaces.ts";
import { getGroup } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { invite, type HistoryChoice } from "../../platform/share.ts";
import { Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

type RoleChoice = "editor" | "viewer";

const ROLES: { value: RoleChoice; label: string }[] = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];
const HISTORY: { value: HistoryChoice; label: string }[] = [
  { value: "from_now", label: "From now" },
  { value: "everything", label: "Everything so far" },
];
const ACCESS: { value: InviteAccess; label: string }[] = [
  { value: "none", label: "No end" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "quarter", label: "3 months" },
];

// Choice buttons: the chosen one is filled.
function Choices<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((o) =>
        o.value === value ? (
          <PrimaryButton key={o.value} label={o.label} onPress={() => onChange(o.value)} style={styles.choice} />
        ) : (
          <SecondaryButton key={o.value} label={o.label} onPress={() => onChange(o.value)} style={styles.choice} />
        ),
      )}
    </View>
  );
}

// Invite someone to a shared space (owners only). The link goes to the iOS share sheet and is not kept on the phone.
export default function InviteScreen() {
  const { group: groupParam } = useLocalSearchParams<{ group: string }>();
  const groupId = groupParam ?? "";
  const group = useQuery((db) => getGroup(db, groupId), groupId);
  const [role, setRole] = useState<RoleChoice>("viewer");
  const [history, setHistory] = useState<HistoryChoice>("from_now");
  const [access, setAccess] = useState<InviteAccess>("none");

  if (group === null || !canInvite(group.role)) {
    return (
      <Screen>
        <Title>Invite someone</Title>
        <Caption>Only an owner can invite someone.</Caption>
      </Screen>
    );
  }

  async function makeLink(): Promise<void> {
    try {
      const url = await invite(groupId, role, history, inviteEnds(access, Date.now(), role));
      await Share.share({ message: url });
      router.back();
    } catch {
      Alert.alert("Couldn't make an invite. Try again.");
    }
  }

  return (
    <Screen>
      <Title>Invite someone</Title>
      <Caption>Role</Caption>
      <Choices options={ROLES} value={role} onChange={setRole} />
      <Caption>History</Caption>
      <Choices options={HISTORY} value={history} onChange={setHistory} />
      <Caption>
        {history === "from_now"
          ? "They'll see notes started from now on. Older notes, and changes to them, stay with you."
          : "They'll see every note in this space, older ones too."}
      </Caption>
      <Caption>Access</Caption>
      <Choices options={ACCESS} value={access} onChange={setAccess} />
      <Caption>The link works once and lasts 7 days.</Caption>
      <PrimaryButton label="Share the link" icon="square.and.arrow.up" onPress={() => void makeLink()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexGrow: 1, minWidth: 130 },
});
