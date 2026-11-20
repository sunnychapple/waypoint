import type { ColorValue } from "react-native";
import { Tabs, router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useConfigRefresh } from "../../platform/config.ts";
import { useDeviceRegistration } from "../../platform/device.ts";
import { useIndexer } from "../../platform/indexer.ts";
import { usePageReader } from "../../platform/pageReading.ts";
import { useStoreSync } from "../../platform/store.ts";
import { usePush } from "../../platform/push.ts";
import { useGroupKeys } from "../../platform/groups.ts";
import { useSync } from "../../platform/sync.ts";
import { useRecoveryPrompt } from "../../platform/recovery.ts";
import "../../platform/jobKinds.ts";
import { useJobs } from "../../platform/jobs.ts";
import { useOverviewRenders } from "../../platform/overviews.ts";
import { useTranscriptionQueue } from "../../platform/transcription.ts";
import { useColors } from "../../ui/theme.ts";

function icon(name: SFSymbol) {
  return ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={24} />;
}

export default function TabsLayout() {
  const colors = useColors();
  useIndexer();
  useConfigRefresh();
  useDeviceRegistration();
  useStoreSync();
  usePageReader();
  usePush();
  useRecoveryPrompt();
  useGroupKeys();
  useSync();
  useJobs();
  useOverviewRenders();
  useTranscriptionQueue();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("house") }} />
      <Tabs.Screen name="spaces" options={{ title: "Spaces", tabBarIcon: icon("folder") }} />
      <Tabs.Screen
        name="record"
        options={{ title: "Record", tabBarIcon: icon("mic.circle.fill") }}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push("/record");
          },
        }}
      />
      <Tabs.Screen name="review" options={{ title: "Review", tabBarIcon: icon("rectangle.stack") }} />
      <Tabs.Screen name="search" options={{ title: "Search", tabBarIcon: icon("magnifyingglass") }} />
    </Tabs>
  );
}
