import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { isDeleteConfirmation, type DeleteFailure } from "../../core/db/users.ts";
import { useDeleteAccount, useSignOut } from "../../platform/auth.tsx";
import { BackButton, Body, Caption, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const FAILURE_COPY: Record<DeleteFailure, string> = {
  offline: "You're offline. Connect to the internet to delete your account.",
  reverify: "For your safety, sign in again, then delete your account.",
  failed: "Your account wasn't deleted. Something went wrong. Try again.",
};

// Deleting the account (App Store 5.1.1(v)). Each sentence below is true of the server (user.deleted removes the user
// row and its devices and memberships; Own it and Plus are released for a later account to claim) and of this iPhone.
export default function DeleteAccountScreen() {
  const colors = useColors();
  const deleteAccount = useDeleteAccount();
  const signOut = useSignOut();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeleteFailure | null>(null);

  const enabled = isDeleteConfirmation(typed) && !busy;

  async function deleteNow() {
    if (!enabled) return;
    setBusy(true);
    setFailure(null);
    const outcome = await deleteAccount();
    // On success the session has ended: the sign-in gate takes over and this screen goes with it.
    if (outcome !== "deleted") {
      setFailure(outcome);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackButton />
      <Title>Delete account</Title>

      <Body>Your NotePath account is deleted, and its credits can't be used any more.</Body>
      <Body>Notes on this iPhone are removed.</Body>
      <Body>Notes you shared stay with the people you shared them with.</Body>
      <Body>If you bought Own it or Plus, you can restore it on a new account.</Body>

      {failure === "reverify" ? (
        <View style={styles.block}>
          <Body>{FAILURE_COPY.reverify}</Body>
          <SecondaryButton label="Sign out" onPress={() => void signOut()} />
        </View>
      ) : (
        <View style={styles.block}>
          <Caption>Type DELETE to confirm.</Caption>
          <TextInput
            accessibilityLabel="Type DELETE to confirm"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setFailure(null);
            }}
            placeholder="DELETE"
            placeholderTextColor={colors.ink4}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityState={{ disabled: !enabled, busy }}
            disabled={!enabled}
            onPress={() => void deleteNow()}
            style={[styles.delete, { backgroundColor: enabled ? colors.danger : colors.surface2 }]}
          >
            <Text style={[styles.deleteText, { color: enabled ? colors.onRec : colors.ink3 }]}>{busy ? "Deleting…" : "Delete my account"}</Text>
          </Pressable>
          {failure !== null ? <Text style={[styles.error, { color: colors.danger }]}>{FAILURE_COPY[failure]}</Text> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12, marginTop: 24 },
  input: { fontSize: 17, minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  delete: { alignItems: "center", justifyContent: "center", minHeight: 50, borderRadius: 14 },
  deleteText: { fontSize: 17, fontWeight: "600" },
  error: { fontSize: 15, lineHeight: 21 },
});
