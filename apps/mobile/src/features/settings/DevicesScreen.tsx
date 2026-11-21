import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { deviceRows, type DeviceRow } from "../../core/device/devices.ts";
import { dateLine } from "../../core/capture/labels.ts";
import { getDeviceKeys } from "../../../modules/waypoint-keys/index.ts";
import { useSignOut } from "../../platform/auth.tsx";
import { hasAccountKeyProblem } from "../../platform/device.ts";
import { listDevices, removeDevice } from "../../platform/devices.ts";
import { BackButton, Caption, Row, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

function subtitle(row: DeviceRow): string {
  if (row.mine) return "This iPhone";
  if (row.waiting) return "Waiting for approval";
  return `Added ${dateLine(row.addedAt, -new Date().getTimezoneOffset())}`;
}

// Settings › Devices (docs/security.md sections 8 and 12).
export default function DevicesScreen() {
  const colors = useColors();
  const signOut = useSignOut();
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [keyProblem, setKeyProblem] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listDevices();
      setRows(deviceRows(list.devices, getDeviceKeys(list.userId)?.deviceId ?? null));
      setLoadFailed(false);
      setKeyProblem(hasAccountKeyProblem());
    } catch {
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function remove(row: DeviceRow): Promise<void> {
    setRemoveFailed(false);
    try {
      const result = await removeDevice(row.id);
      if (result === "removed_self") {
        await signOut();
        return;
      }
      if (result === "changed") {
        Alert.alert("Your devices changed", "Check the list and try again.");
        await load();
        return;
      }
      if (!row.waiting) setNeedsKey(true);
      await load();
    } catch {
      setRemoveFailed(true);
    }
  }

  function confirmRemove(row: DeviceRow): void {
    if (row.mine) {
      Alert.alert("Remove this iPhone?", "NotePath signs out on this iPhone. Your notes on it stay here.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove(row) },
      ]);
      return;
    }
    Alert.alert(`Remove ${row.name}?`, "It won't be able to use credits or open anything new. Notes already on it stay on it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove(row) },
    ]);
  }

  function open(row: DeviceRow): void {
    if (row.waiting) router.push(`/devices/approve?id=${encodeURIComponent(row.id)}`);
    else confirmRemove(row);
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      >
        <BackButton />
        <Title>Devices</Title>
        {needsKey ? (
          <View style={styles.notice}>
            <Caption>Make new recovery words: your old ones stopped working.</Caption>
            <SecondaryButton label="Make new recovery words" onPress={() => router.push("/recovery-words")} />
          </View>
        ) : null}
        {keyProblem ? <Caption>This iPhone can't unlock your notes. Remove it from another device and add it again.</Caption> : null}
        {removeFailed ? <Caption>Couldn't remove it. Try again.</Caption> : null}
        {loadFailed && rows === null ? <Caption>Can't load devices offline.</Caption> : null}
        {rows?.map((row) => (
          <Row
            key={row.id}
            title={row.name}
            subtitle={subtitle(row)}
            right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />}
            onPress={() => open(row)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  notice: { gap: 12 },
});
