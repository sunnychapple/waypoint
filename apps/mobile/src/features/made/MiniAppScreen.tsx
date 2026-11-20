import { useMemo } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SandboxView } from "../../../modules/waypoint-sandbox/index.ts";
import { getMade } from "../../core/made/made.ts";
import { miniAppPage } from "../../core/made/sandbox.ts";
import { useConfig } from "../../platform/config.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// A saved mini app in the locked web view (M25b). Shown only while the KV flag mini_app_viewer is true in the cached
// config; with it off nothing of the mini app reaches the screen.
export default function MiniAppScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useQuery((db) => getMade(db, id), id);
  const enabled = useConfig()?.flags.mini_app_viewer === true;
  const page = useMemo(() => (enabled && item?.kind === "mini_app" ? miniAppPage(item.body.html) : ""), [enabled, item]);

  if (!enabled) {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Title>Mini apps aren't available yet.</Title>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (item === null || item.kind !== "mini_app") {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Title>Couldn't open this mini app.</Title>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 8 }}>
      <Title>{item.body.title}</Title>
      <View style={{ flex: 1 }}>
        <SandboxView page={page} mermaid={false} style={{ flex: 1 }} />
      </View>
      <Caption>This mini app can't use the internet or see anything else on your iPhone.</Caption>
      <SecondaryButton label="Done" onPress={() => router.back()} />
    </SafeAreaView>
  );
}
