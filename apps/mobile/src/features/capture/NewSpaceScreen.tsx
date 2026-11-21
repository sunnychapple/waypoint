import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { randomUUID } from "expo-crypto";
import { getSession, moveSessionToSpace } from "../../core/capture/sessions.ts";
import { createSpace, getSpace, setSavingTo, SpaceNameError } from "../../core/db/spaces.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { newSharedSpace } from "../../platform/share.ts";
import { getDb, useQuery, writeDb } from "../../platform/db.ts";
import { Caption, PrimaryButton, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Belongs = "just_me" | "shared";

// Opened from the space picker (?from=picker), or from the Spaces tab (no param). From the picker for a session
// (?sessionId=) the new space is where that session moves, not "Saving to".
export default function NewSpaceScreen() {
  const colors = useColors();
  const { from, sessionId } = useLocalSearchParams<{ from?: string; sessionId?: string }>();
  const fromPicker = from === "picker";
  // The space the session is in now, when it is in a shared one (leaving it is confirmed, as in the picker).
  const leaving = useQuery((db) => {
    if (!sessionId) return null;
    const spaceId = getSession(db, sessionId)?.spaceId ?? null;
    if (spaceId === null || spaceGroups(db).get(spaceId)?.kind !== "shared") return null;
    return getSpace(db, spaceId)?.name ?? "the shared space";
  }, sessionId ?? "");
  const [name, setName] = useState("");
  const [belongs, setBelongs] = useState<Belongs>("just_me");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // a second tap before a shared space's request ends is ignored

  const mounted = useRef(true); // the sheet may be swiped away while a shared space is being made
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function create(confirmed = false): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give it a name.");
      return;
    }
    // Moving a session into or out of a shared space is confirmed: everyone there gains or loses it (M30b).
    if (fromPicker && sessionId && !confirmed && (belongs === "shared" || leaving !== null)) {
      const lines = [
        leaving !== null ? `It will be removed for everyone in ${leaving}.` : null,
        belongs === "shared" ? `Everyone in ${trimmed} will see this session.` : null,
      ];
      Alert.alert("Move this session?", lines.filter((line) => line !== null).join(" "), [
        { text: "Cancel", style: "cancel" },
        { text: "Move", onPress: () => void create(true) },
      ]);
      return;
    }
    if (belongs === "shared") return createShared(trimmed);
    try {
      const space = writeDb((db) => createSpace(db, { now: Date.now, newId: randomUUID }, trimmed));
      if (fromPicker) {
        writeDb((db) => {
          if (sessionId) moveSessionToSpace(db, sessionId, space.id, Date.now());
          else setSavingTo(db, space.id, Date.now());
        });
        router.dismiss(2); // closes this sheet and the space picker under it
      } else {
        router.replace(`/space/${space.id}`); // swaps the sheet for the space (a back then a push in one tick can be lost)
      }
    } catch (e) {
      if (e instanceof SpaceNameError && e.message === "taken") {
        setError(`You already have a space called ${trimmed}.`);
        return;
      }
      if (e instanceof SpaceNameError) {
        setError(e.message === "too_long" ? "That name is too long." : "Give it a name.");
        return;
      }
      throw e;
    }
  }

  // The same creation and error as /shared/new: a local space plus a group, then that shared space.
  async function createShared(trimmed: string): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const groupId = await newSharedSpace(trimmed);
      if (!mounted.current) return; // closed meanwhile: do not navigate from whatever screen is on top now
      if (fromPicker) {
        // The session (or, without one, "Saving to") goes to the new shared space, then this sheet and the picker close.
        const row = getDb().get<{ space_id: string }>("SELECT space_id FROM space_groups WHERE group_id = ?", [groupId]);
        if (row !== null) {
          const spaceId = row.space_id;
          writeDb((db) => {
            if (sessionId) moveSessionToSpace(db, sessionId, spaceId, Date.now());
            else setSavingTo(db, spaceId, Date.now());
          });
        }
        router.dismiss(2);
      } else router.replace(`/shared/${encodeURIComponent(groupId)}`);
    } catch (e) {
      inFlight.current = false;
      if (!mounted.current) return;
      if (e instanceof SpaceNameError && e.message === "taken") {
        setError(`You already have a space called ${trimmed}.`);
        return;
      }
      setError("Couldn't create it. Try again.");
    }
  }

  return (
    <Screen>
      <Title>New space</Title>
      <View style={styles.field}>
        <TextInput
          accessibilityLabel="Space name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          onSubmitEditing={() => void create()}
          placeholder="Math, Science, History…"
          placeholderTextColor={colors.ink4}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.lineStrong, color: colors.ink }]}
        />
        {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      </View>
      <View style={styles.choices}>
        <Row
          title="Just me"
          subtitle="Only you can see it"
          selected={belongs === "just_me"}
          right={belongs === "just_me" ? <Check /> : null}
          onPress={() => setBelongs("just_me")}
        />
        <Row
          title="Shared"
          subtitle="Invite family or classmates"
          selected={belongs === "shared"}
          right={belongs === "shared" ? <Check /> : null}
          onPress={() => setBelongs("shared")}
        />
      </View>
      <PrimaryButton label="Create" onPress={() => void create()} />
    </Screen>
  );
}

function Check() {
  const colors = useColors();
  return <SymbolView name="checkmark" tintColor={colors.accent} size={18} />;
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
  choices: { gap: 8 },
});
