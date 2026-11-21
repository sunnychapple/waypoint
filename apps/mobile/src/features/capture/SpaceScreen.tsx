import { useState } from "react";
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { sessionsInSpace } from "../../core/capture/sessions.ts";
import { getSetting } from "../../core/db/settings.ts";
import { deleteSpace, getSpace, renameSpace, setSavingTo, SpaceNameError } from "../../core/db/spaces.ts";
import { getGroup, spaceGroups } from "../../core/groups/groups.ts";
import { countLabel, formatClock } from "../../core/format.ts";
import { canAddTo } from "../../core/share/spaces.ts";
import { SYNC_LIMIT_KEY, sendingPaused } from "../../core/sync/limit.ts";
import { useMinuteNow, useQuery, writeDb } from "../../platform/db.ts";
import { SYNC_PLAN_KEY, isSpaceSynced, turnOnSync } from "../../platform/sync.ts";
import { BackButton, Body, Caption, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { StartTile } from "./StartTile.tsx";

export default function SpaceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useMinuteNow();
  const data = useQuery(
    (db) => {
      const link = spaceGroups(db).get(id) ?? null;
      return {
        space: getSpace(db, id),
        sessions: sessionsInSpace(db, id),
        synced: isSpaceSynced(db, id),
        planRequired: getSetting(db, SYNC_PLAN_KEY) === "1",
        limited: sendingPaused(getSetting(db, SYNC_LIMIT_KEY), now),
        link,
        // Only a shared space gets a People row; a personal group is the "Sync with my other devices" one.
        shared: link?.kind === "shared" ? link : null,
        memberCount: link === null ? null : (getGroup(db, link.groupId)?.members.length ?? null),
      };
    },
    `${id}:${now}`,
  );
  const name = data.space?.name ?? "";
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Record and snap save into this space: set it as "Saving to" first, then open the capture screen.
  const captureInto = (route: string) => {
    writeDb((db) => setSavingTo(db, id, Date.now()));
    router.push(route);
  };

  // A shared space takes its name from its group (platform/groups.ts), so only a personal or unsynced space is renamed.
  const canRename = !data.synced || data.link?.kind === "personal";
  // Sync does not carry a space delete, so a space that syncs or is shared stays, and so does one with notes or the default.
  const canDelete = data.space !== null && !data.synced && data.space.sessionCount === 0 && !data.space.isDefault;

  // Alert.prompt cannot show an error in the field, so a bad name comes back in the prompt's message with what was typed.
  const startRename = (typed = name, problem?: string) => {
    Alert.prompt(
      "Rename space",
      problem,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save", onPress: (value?: string) => saveName(value ?? "") },
      ],
      "plain-text",
      typed,
    );
  };

  const saveName = (value: string) => {
    try {
      writeDb((db) => renameSpace(db, id, value));
    } catch (e) {
      if (!(e instanceof SpaceNameError)) throw e;
      const trimmed = value.trim();
      if (e.message === "taken") startRename(trimmed, `You already have a space called ${trimmed}.`);
      else startRename(trimmed, e.message === "too_long" ? "That name is too long." : "Give it a name.");
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete this space?", "It has no notes, so nothing is lost.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: deleteNow },
    ]);
  };

  const deleteNow = () => {
    try {
      writeDb((db) => deleteSpace(db, id));
      router.back();
    } catch {
      Alert.alert("Couldn't delete this space", "Move or delete its notes first.");
    }
  };

  const openMenu = () => {
    const options: string[] = [];
    const actions: (() => void)[] = [];
    if (canRename) {
      options.push("Rename");
      actions.push(() => startRename());
    }
    if (canDelete) {
      options.push("Delete space");
      actions.push(confirmDelete);
    }
    options.push("Cancel");
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: canDelete ? options.length - 2 : undefined,
      },
      (index) => actions[index]?.(),
    );
  };

  const startSync = () => {
    setBusy(true);
    setFailed(false);
    turnOnSync(id)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <View style={styles.topRow}>
        <BackButton />
        {canRename || canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Space options"
            onPress={openMenu}
            style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
          >
            <SymbolView name="ellipsis" tintColor={colors.ink} size={18} />
          </Pressable>
        ) : null}
      </View>
      <Title>{name}</Title>
      {data.space && canAddTo(data.link?.role ?? null) ? (
        <>
          <View style={styles.starts}>
            <StartTile
              label="Record"
              detail="A class or a talk"
              icon="mic.fill"
              fill={colors.rec}
              ink={colors.onRec}
              onPress={() => captureInto("/recording")}
            />
            <StartTile
              label="Snap pages"
              detail="Homework, books"
              icon="camera.fill"
              fill={colors.accent}
              ink={colors.onAccent}
              onPress={() => captureInto("/pages/new")}
            />
          </View>
          <SecondaryButton label="From Photos" onPress={() => captureInto("/pages/new?from=photos")} />
        </>
      ) : null}
      {data.shared ? (
        <Row
          title="People"
          {...(data.memberCount === null ? {} : { subtitle: countLabel(data.memberCount, "person", "people") })}
          right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
          onPress={() => router.push(`/shared/${encodeURIComponent(data.shared?.groupId ?? "")}`)}
        />
      ) : null}
      {data.synced ? (
        <Row title="Syncing with your other devices" />
      ) : (
        <Row title="Sync with my other devices" right={<Switch value={false} disabled={busy} onValueChange={startSync} />} />
      )}
      <Caption>Keeps this space on your other devices, and lets your recovery words bring it back if you lose this iPhone.</Caption>
      {!data.synced ? <Caption>Photos and audio sync on paid plans.</Caption> : null}
      {data.synced && data.planRequired ? <Body>Photos and audio sync on paid plans.</Body> : null}
      {data.synced && data.limited ? (
        <>
          <Body>Today's sync is used up. Changes wait on this iPhone.</Body>
          <SecondaryButton label="Add more for today" icon="arrow.up.circle" onPress={() => router.push("/sync-limit")} />
        </>
      ) : null}
      {failed ? <Body>Couldn't start sync. Try again.</Body> : null}
      {data.sessions.length === 0 ? (
        <Body>Nothing here yet. Things you save to {name} show up here.</Body>
      ) : (
        data.sessions.map((s) => {
          const date = new Date(s.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const detail = s.kind === "recording" ? formatClock(s.recordedMs) : countLabel(s.pages, "page", "pages");
          return (
            <Row
              key={s.id}
              title={s.title}
              subtitle={`${date} · ${detail}`}
              leading={
                <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
                  <SymbolView name={s.kind === "recording" ? "mic.fill" : "doc.text"} tintColor={colors.ink} size={20} />
                </View>
              }
              onPress={() => router.push(`/session/${s.id}`)}
            />
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  starts: { flexDirection: "row", gap: 12 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
