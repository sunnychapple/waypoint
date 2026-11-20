import { useMemo } from "react";
import { useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SandboxView } from "../../../modules/waypoint-sandbox/index.ts";
import { getMade } from "../../core/made/made.ts";
import { diagramPage } from "../../core/made/sandbox.ts";
import { useConfig } from "../../platform/config.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// A saved diagram, drawn on this iPhone by Mermaid inside the locked web view (M25b). Shown only while the KV flag
// diagram_viewer is true in the cached config (default off, until the device gate passes).
export default function DiagramScreen() {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useQuery((db) => getMade(db, id), id);
  const enabled = useConfig()?.flags.diagram_viewer === true;
  const page = useMemo(() => (enabled && item?.kind === "diagram" ? diagramPage(item.body.mermaid, dark) : ""), [enabled, item, dark]);

  if (!enabled) {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Title>Diagrams aren't available yet.</Title>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (item === null || item.kind !== "diagram") {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Title>Couldn't open this diagram.</Title>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 8 }}>
      <Title>{item.body.title}</Title>
      <View style={{ flex: 1 }}>
        <SandboxView page={page} mermaid style={{ flex: 1 }} />
      </View>
      <Caption>Drawn on this iPhone.</Caption>
      <SecondaryButton label="Done" onPress={() => router.back()} />
    </SafeAreaView>
  );
}
