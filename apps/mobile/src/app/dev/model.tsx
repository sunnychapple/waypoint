import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { getAvailability, getContextSize, helpWithProblem, makeCards, makeQuiz } from "../../../modules/waypoint-model/index.ts";
import { cleanCards, cleanHelp, cleanQuiz } from "../../core/study/drafts.ts";
import { useColors } from "../../ui/theme.ts";

function describeError(error: unknown): string {
  if (error instanceof Error) return "code" in error ? `${String(error.code)}: ${error.message}` : error.message;
  return String(error);
}

export default function ModelDevScreen() {
  const colors = useColors();
  const [info] = useState(() => ({ availability: getAvailability(), contextSize: getContextSize() }));
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");

  async function run(action: () => Promise<unknown>) {
    try {
      setOutput(JSON.stringify(await action(), null, 2));
    } catch (error) {
      setOutput(`Error ${describeError(error)}`);
    }
  }

  const actions = [
    { label: "Cards", run: async () => cleanCards(await makeCards(text, 10), 10) },
    { label: "Quiz", run: async () => cleanQuiz(await makeQuiz(text, 5), 5) },
    { label: "Help", run: async () => cleanHelp(await helpWithProblem(text, "")) },
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.body}>
      <Text style={[styles.meta, { color: colors.ink2 }]}>Availability: {info.availability}</Text>
      <Text style={[styles.meta, { color: colors.ink2 }]}>Context size: {info.contextSize}</Text>
      <TextInput
        multiline
        value={text}
        onChangeText={setText}
        placeholder="Paste a page or a problem"
        placeholderTextColor={colors.ink4}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
      />
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => run(action.run)}
          style={[styles.button, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonText, { color: colors.onAccent }]}>{action.label}</Text>
        </Pressable>
      ))}
      <Text selectable style={[styles.output, { color: colors.ink }]}>{output}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  meta: { fontSize: 14 },
  input: { minHeight: 140, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: "top" },
  button: { paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
  output: { fontSize: 13, fontFamily: "Menlo" },
});
