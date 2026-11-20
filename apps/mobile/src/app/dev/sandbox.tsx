import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SandboxView } from "../../../modules/waypoint-sandbox/index.ts";
import { GATE_HTML } from "../../core/made/gate.ts";
import { useColors } from "../../ui/theme.ts";

// The M25b gate, development builds only. Enter the Mac's address, load the gate, wait 10 seconds, then check the
// Mac's server log and the page. "Reload" makes a new web view, so a value stored by the page must be gone.
export default function DevSandbox() {
  const colors = useColors();
  const [address, setAddress] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const valid = /^[A-Za-z0-9.-]+$/.test(address.trim());

  function load() {
    setHtml(GATE_HTML.replaceAll("HOST", address.trim()));
    setRun((n) => n + 1);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <TextInput
        accessibilityLabel="Mac address"
        placeholder="192.168.1.20"
        autoCapitalize="none"
        autoCorrect={false}
        value={address}
        onChangeText={setAddress}
        style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!valid}
        onPress={load}
        style={[styles.button, { backgroundColor: colors.accent, opacity: valid ? 1 : 0.4 }]}
      >
        <Text style={{ color: colors.onAccent, fontWeight: "600", textAlign: "center" }}>Load gate</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={html === null}
        onPress={() => setRun((n) => n + 1)}
        style={[styles.button, { backgroundColor: colors.surface2, opacity: html === null ? 0.4 : 1 }]}
      >
        <Text style={{ color: colors.ink, fontWeight: "600", textAlign: "center" }}>Reload</Text>
      </Pressable>
      {html !== null ? <SandboxView key={run} page={html} mermaid={false} style={{ flex: 1 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, paddingTop: 60, gap: 12 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 17 },
  button: { borderRadius: 12, padding: 14 },
});
