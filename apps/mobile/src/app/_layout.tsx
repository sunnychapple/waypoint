import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useGate } from "../platform/auth.tsx";
import { useColors } from "../ui/theme.ts";

function RootStack() {
  const colors = useColors();
  const gate = useGate();
  if (gate === "wait") return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={gate === "app"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="update" options={{ presentation: "modal" }} />
        <Stack.Screen name="settings-permissions" />
        <Stack.Screen name="settings-storage" />
        <Stack.Screen name="space-picker" options={{ presentation: "formSheet" }} />
        <Stack.Screen name="new-space" options={{ presentation: "formSheet" }} />
        <Stack.Screen name="space/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="pages/new" />
        <Stack.Screen name="pages/[id]" />
        <Stack.Screen name="session/[id]" />
        <Stack.Screen name="study/make" />
        <Stack.Screen name="study/review" />
        <Stack.Screen name="study/quiz" />
        <Stack.Screen name="study/help" />
        <Stack.Screen name="study/help-steps" />
      </Stack.Protected>
      <Stack.Protected guard={gate === "sign_in"}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="check-email" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootStack />
    </AuthProvider>
  );
}
