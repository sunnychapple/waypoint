import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { RecoveryState } from "../../core/device/recovery.ts";
import { canMakeRecoveryKey, loadRecoveryState } from "../../platform/recovery.ts";
import { BackButton, Body, Caption, PrimaryButton, Row, Screen, Title } from "../../ui/kit.tsx";

const LABEL: Record<RecoveryState, string> = {
  saved: "Saved and checked",
  unchecked: "Saved, not checked",
  missing: "Not set up",
  unknown: "Can't check while offline",
};

export default function RecoveryKeyScreen() {
  const [state, setState] = useState<RecoveryState | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadRecoveryState().then(setState);
    }, []),
  );

  return (
    <Screen>
      <BackButton />
      <Title>Recovery words</Title>
      <Row title="Status" right={<Caption>{state === null ? "Checking…" : LABEL[state]}</Caption>} />
      <Body>If you lose all your devices, your recovery words bring back the spaces with sync turned on.</Body>
      <View style={styles.actions}>
        {canMakeRecoveryKey() ? (
          <>
            <PrimaryButton label="Make new recovery words" onPress={() => router.push("/recovery-words")} />
            <Caption>New recovery words replace the old ones. The old words stop working.</Caption>
          </>
        ) : (
          <Caption>This iPhone can't make recovery words yet.</Caption>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 12, marginTop: 24 },
});
