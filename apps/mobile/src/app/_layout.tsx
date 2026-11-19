import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColors } from "../ui/theme.ts";

export default function RootLayout() {
  const colors = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="settings" />
      </Stack>
    </>
  );
}
