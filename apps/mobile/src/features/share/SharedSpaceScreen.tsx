import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { shortDay } from "../../core/format.ts";
import { dateLine } from "../../core/capture/labels.ts";
import { getGroup, heldVersions, spaceForGroup } from "../../core/groups/groups.ts";
import { canInvite, canLeave, canRemove, memberLabels, type Role } from "../../core/share/spaces.ts";
import { refreshGroups } from "../../platform/groups.ts";
import { currentUserId } from "../../platform/device.ts";
import { useQuery } from "../../platform/db.ts";
import { leave, mySafetyCode, pendingKeyChanges, removeMember, type PendingKeyChange } from "../../platform/share.ts";
import { BackButton, Body, Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const ROLE_NAMES: Record<Role, string> = { owner: "Owner", editor: "Can edit", viewer: "Can view" };
const day = shortDay;

// A shared space: members, invites (owners), removing members, the security key notice, and leaving (M30a).
export default function SharedSpaceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useQuery((db) => getGroup(db, id), id);
  const held = useQuery((db) => heldVersions(db, id), id);
  const spaceId = useQuery((db) => spaceForGroup(db, id), id);
  const [pending, setPending] = useState<PendingKeyChange[]>([]);
  const [myCode, setMyCode] = useState<string | null>(null);
  const me = currentUserId() ?? "";

  useFocusEffect(
    useCallback(() => {
      refreshGroups().catch(() => undefined);
      pendingKeyChanges().then(setPending).catch(() => setPending([]));
      mySafetyCode().then(setMyCode).catch(() => setMyCode(null));
    }, []),
  );

  if (group === null) {
    return (
      <Screen>
        <BackButton />
        <Title>Shared space</Title>
      </Screen>
    );
  }

  const labels = memberLabels(group.members, me);
  const changed = pending.filter((p) => group.members.some((m) => m.user_id === p.userId));
  const currentSince = held.find((version) => version.keyVersion === group.keyVersion)?.learnedAt;

  function confirmRemove(userId: string, label: string): void {
    Alert.alert(`Remove ${label}?`, "They keep what they already saw, but won't see anything new.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          removeMember(id, userId).catch(() => Alert.alert("Couldn't remove them. Try again."));
        },
      },
    ]);
  }

  function confirmLeave(): void {
    Alert.alert("Leave this shared space?", "You won't get its new notes any more.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => {
          leave(id)
            .then(() => router.back())
            .catch(() => Alert.alert("Couldn't leave. Try again."));
        },
      },
    ]);
  }

  function trust(change: PendingKeyChange): void {
    change
      .trust()
      .then(() => pendingKeyChanges().then(setPending))
      .catch(() => Alert.alert("Couldn't confirm it's them. Try again."));
  }

  return (
    <Screen>
      <BackButton />
      <Title>{group.name === "" ? "Shared space" : group.name}</Title>
      {held.length === 0 ? <Caption>Waiting for the owner to let you in. Ask them to open NotePath on their phone.</Caption> : null}
      {spaceId !== null ? (
        <Row
          title="Sessions"
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/space/${spaceId}`)}
        />
      ) : null}

      {changed.map((change) => (
        <View key={change.userId} style={[styles.notice, { backgroundColor: colors.surface2 }]}>
          <Body style={{ fontWeight: "600", color: colors.ink }}>{`Check this is really ${labels.get(change.userId) ?? "A member"}`}</Body>
          <Caption>
            They may have a new phone. Until you check, they can't see new notes here, and you won't see theirs. Ask them to open this shared space and read you
            their safety code. It should match this one.
          </Caption>
          <Caption>Code: {change.code}</Caption>
          <PrimaryButton label="It's them" onPress={() => trust(change)} />
        </View>
      ))}

      <Caption>People</Caption>
      {group.members.map((m) => {
        const label = labels.get(m.user_id) ?? "Member";
        const access = m.ends_at === null ? "" : `. Access ends ${dateLine(m.ends_at, -new Date().getTimezoneOffset())}`;
        const removable = m.user_id !== me && canRemove(group.role, m.role);
        return (
          <Row
            key={m.user_id}
            title={label}
            subtitle={`${ROLE_NAMES[m.role]}${access}`}
            right={removable ? <SymbolView name="minus.circle" tintColor={colors.danger} size={18} /> : undefined}
            onPress={removable ? () => confirmRemove(m.user_id, label) : undefined}
          />
        );
      })}

      {myCode !== null ? (
        <View style={styles.code}>
          <Caption>Your safety code</Caption>
          <Body style={{ fontWeight: "600", color: colors.ink }}>{myCode}</Body>
          <Caption>If someone here asks you to check, read them this code.</Caption>
        </View>
      ) : null}

      <Row
        title="Who can see these notes"
        {...(currentSince === undefined ? {} : { subtitle: `Updated ${day(currentSince)}` })}
        right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
        onPress={() => router.push(`/shared/keys?groupId=${encodeURIComponent(id)}`)}
      />

      {canInvite(group.role) ? (
        <PrimaryButton
          label="Invite someone"
          icon="person.badge.plus"
          onPress={() => router.push(`/shared/invite?group=${encodeURIComponent(id)}`)}
        />
      ) : null}

      {canLeave(group.members, me) ? (
        <View style={styles.leave}>
          <Caption>Leaving keeps your copy of the notes on this iPhone.</Caption>
          <SecondaryButton label="Leave this shared space" icon="rectangle.portrait.and.arrow.right" tone="surface" onPress={confirmLeave} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 10, padding: 14, borderRadius: 16 },
  leave: { gap: 10, marginTop: 8 },
  code: { gap: 6, marginTop: 8 },
});
