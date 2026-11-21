import { useRef, useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { inviteEnds, canInvite, type InviteAccess } from "../../core/share/spaces.ts";
import { getGroup } from "../../core/groups/groups.ts";
import { useQuery } from "../../platform/db.ts";
import { invite, type HistoryChoice } from "../../platform/share.ts";
import { toFailure } from "../../platform/tasks.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

type RoleChoice = "editor" | "viewer";

const ROLES: { value: RoleChoice; label: string; explain: string }[] = [
  { value: "editor", label: "Editor", explain: "Can add and change notes" },
  { value: "viewer", label: "Viewer", explain: "Can only look" },
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

// Invite someone to a shared space (owners only). Making the link creates the invite on the server, so the link is kept
// here until this screen closes: if the share sheet is cancelled, "Share again" sends the same link rather than a new one.
export default function InviteScreen() {
  const { group: groupParam } = useLocalSearchParams<{ group: string }>();
  const groupId = groupParam ?? "";
  const group = useQuery((db) => getGroup(db, groupId), groupId);
  const [role, setRole] = useState<RoleChoice>("viewer");
  const [history, setHistory] = useState<HistoryChoice>("from_now");
  const [access, setAccess] = useState<InviteAccess>("none");
  const [link, setLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const making = useRef(false); // a second tap while the invite is being made would make a second open invite

  if (group === null || !canInvite(group.role)) {
    return (
      <Screen>
        <Title>Invite someone</Title>
        <Caption>Only an owner can invite someone.</Caption>
      </Screen>
    );
  }

  // A link made with other choices would not match what is shown, so changing a choice drops it.
  function choose<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setLink(null);
    };
  }

  async function shareLink(): Promise<void> {
    let url = link;
    if (url === null) {
      if (making.current) return;
      making.current = true;
      try {
        url = await invite(groupId, role, history, inviteEnds(access, Date.now(), role));
      } catch (error) {
        Alert.alert(toFailure(error).kind === "offline" ? "You're offline. Connect to the internet and try again." : "Couldn't make an invite. Try again.");
        return;
      } finally {
        making.current = false;
      }
      setLink(url);
    }
    try {
      const result = await Share.share({ message: url });
      if (result.action === Share.sharedAction) setSent(true);
    } catch {
      Alert.alert("Couldn't open the share sheet");
    }
  }

  if (sent) {
    return (
      <Screen>
        <Title>Invite sent</Title>
        <Body>When they join, open NotePath so they can see the notes.</Body>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Invite someone</Title>
      <Caption>Role</Caption>
      <Choices options={ROLES} value={role} onChange={choose(setRole)} />
      {ROLES.map((r) => (
        <Caption key={r.value}>{`${r.label}: ${r.explain}`}</Caption>
      ))}
      <Caption>History</Caption>
      <Choices options={HISTORY} value={history} onChange={choose(setHistory)} />
      <Caption>
        {history === "from_now"
          ? "They'll see notes started from now on. Older notes, and changes to them, stay with you."
          : "They'll see every note in this space, older ones too."}
      </Caption>
      <Caption>Access</Caption>
      <Choices options={ACCESS} value={access} onChange={choose(setAccess)} />
      <Caption>The link works once and lasts 7 days.</Caption>
      {link === null ? (
        <PrimaryButton label="Share the link" icon="square.and.arrow.up" onPress={() => void shareLink()} />
      ) : (
        <>
          <Caption>The link is made but not sent yet. Share again to send this same link.</Caption>
          <PrimaryButton label="Share again" icon="square.and.arrow.up" onPress={() => void shareLink()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexGrow: 1, minWidth: 130 },
});
