import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SpaceNameError } from "../../core/db/spaces.ts";
import { newSharedSpace } from "../../platform/share.ts";
import { Caption, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// A new shared space: a local space with this name, and a group that the people you invite join.
export default function NewSharedSpaceScreen() {
  const colors = useColors();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give it a name.");
      return;
    }
    try {
      const groupId = await newSharedSpace(trimmed);
      router.replace(`/shared/${encodeURIComponent(groupId)}`);
    } catch (e) {
      if (e instanceof SpaceNameError && e.message === "taken") {
        setError(`You already have a space called ${trimmed}.`);
        return;
      }
      setError("Couldn't create it. Try again.");
    }
  }

  return (
    <Screen>
      <Title>New shared space</Title>
      <View style={styles.field}>
        <TextInput
          accessibilityLabel="Shared space name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          onSubmitEditing={() => void create()}
          placeholder="Family, Study group…"
          placeholderTextColor={colors.ink4}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.lineStrong, color: colors.ink }]}
        />
        {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      </View>
      <PrimaryButton label="Create" onPress={() => void create()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
});
