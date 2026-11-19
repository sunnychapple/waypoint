import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { createSpace, setSavingTo, SpaceNameError } from "../../core/db/spaces.ts";
import { writeDb } from "../../platform/db.ts";
import { Caption, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

export default function NewSpaceScreen() {
  const colors = useColors();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function create() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give it a name.");
      return;
    }
    try {
      const space = writeDb((db) => createSpace(db, { now: Date.now, newId: randomUUID }, trimmed));
      writeDb((db) => setSavingTo(db, space.id, Date.now()));
    } catch (e) {
      if (e instanceof SpaceNameError && e.message === "taken") {
        setError(`You already have a space called ${trimmed}.`);
        return;
      }
      throw e;
    }
    // Closes this sheet and the space picker under it.
    router.dismiss(2);
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
          onSubmitEditing={create}
          placeholder="Math, Science, History…"
          placeholderTextColor={colors.ink4}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.lineStrong, color: colors.ink }]}
        />
        {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      </View>
      <PrimaryButton label="Create" onPress={create} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
});
