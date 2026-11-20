import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { dateLine } from "../../core/capture/labels.ts";
import { getGroup, heldVersions } from "../../core/groups/groups.ts";
import { canInvite, canLeave, canRemove, memberLabels, type Role } from "../../core/share/spaces.ts";
import { refreshGroups } from "../../platform/groups.ts";
import { currentUserId } from "../../platform/device.ts";
import { useQuery } from "../../platform/db.ts";
import { leave, pendingKeyChanges, removeMember, type PendingKeyChange } from "../../platform/share.ts";
import { Body, Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const ROLE_NAMES: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

function BackButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => router.back()}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

// A shared space: members, invites (owners), removing members, the security key notice, and leaving (M30a).
export default function SharedSpaceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useQuery((db) => getGroup(db, id), id);
  const heldCount = useQuery((db) => heldVersions(db, id).length, id);
  const [pending, setPending] = useState<PendingKeyChange[]>([]);
  const me = currentUserId() ?? "";

  useFocusEffect(
    useCallback(() => {
      refreshGroups().catch(() => undefined);
      pendingKeyChanges().then(setPending).catch(() => setPending([]));
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

  function confirmRemove(userId: string, label: string): void {
    Alert.alert(`Remove ${label}?`, "They keep what they already saw. New notes use a new key.", [
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
      .catch(() => Alert.alert("Couldn't trust the new key. Try again."));
  }

  return (
    <Screen>
      <BackButton />
      <Title>{group.name === "" ? "Shared space" : group.name}</Title>
      {heldCount === 0 ? <Caption>Waiting for a key from the owner…</Caption> : null}

      {changed.map((change) => (
        <View key={change.userId} style={[styles.notice, { backgroundColor: colors.surface2 }]}>
          <Body style={{ fontWeight: "600", color: colors.ink }}>{`${labels.get(change.userId) ?? "A member"}'s security key changed`}</Body>
          <Caption>
            Their notes are not shared with their new key until you check. Compare the safety code with them, or tap Trust if you know they changed
            devices.
          </Caption>
          <Caption>Safety code: {change.code}</Caption>
          <PrimaryButton label="Trust the new key" onPress={() => trust(change)} />
        </View>
      ))}

      <Caption>Members</Caption>
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
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  notice: { gap: 10, padding: 14, borderRadius: 16 },
  leave: { gap: 10, marginTop: 8 },
});
