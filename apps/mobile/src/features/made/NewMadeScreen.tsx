import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { JOB_PROMPT_MAX_CHARS } from "@waypoint/contracts";
import { failureCopy, keepsKey, type CloudFailure, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel } from "../../core/config/config.ts";
import { keyForRequest } from "../../core/research/research.ts";
import { useQuote } from "../../platform/jobs.ts";
import { madeText, startMade } from "../../platform/made.ts";
import { Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { QuoteBox } from "../../ui/QuoteBox.tsx";
import { useColors } from "../../ui/theme.ts";

// "Practice set": questions made from one session, with an optional focus and the price from the quote (M25a).
// Opened from a session (sessionId). Practice needs no web view; the set is saved when the job's result opens.
const ACTION_LABELS: Partial<Record<FailureAction, string>> = {
  try_again: "Try again",
  get_credits: "Get credits",
  approve_device: "Set up this iPhone",
  close: "Close",
};

export default function NewMadeScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = params.sessionId ?? null;
  const [focus, setFocus] = useState("");
  const [showSent, setShowSent] = useState(false);
  // The last failed request that may be re-sent (keepsKey), with its key and body. "Try again" reuses the key only
  // while the body is unchanged (keyForRequest).
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<CloudFailure | null>(null);
  const quote = useQuote({ task: "practice" });
  const price = quote.quote?.credits ?? null;
  const text = sessionId !== null ? madeText(sessionId, "practice") : "";
  const hasText = text !== "";

  async function start(): Promise<void> {
    if (sessionId === null || !hasText || price === null || starting) return;
    setStarting(true);
    setFailure(null);
    const prompt = focus.trim() === "" ? null : focus.trim();
    const body = JSON.stringify({ kind: "practice", sessionId, text, prompt });
    const key = keyForRequest(attempt.current, body, () => randomUUID());
    const result = await startMade("practice", sessionId, key, prompt);
    setStarting(false);
    if (result.ok) {
      router.replace(`/job/${encodeURIComponent(result.jobId)}`);
      return;
    }
    setFailure(result.failure);
    attempt.current = keepsKey(result.failure) ? { key, body } : null;
  }

  function act(action: FailureAction): void {
    if (action === "try_again") void start();
    else if (action === "get_credits" && failure?.kind === "out_of_credits") router.push(`/plans?need=${failure.shortfall}`);
    else if (action === "approve_device") router.push("/device-waiting");
    else if (action === "close") router.back();
  }

  const copy = failure === null ? null : failureCopy(failure);

  return (
    <Screen>
      <View style={styles.topRow}>
        <CircleButton label="Back" icon="chevron.left" onPress={() => router.back()} />
      </View>
      <Title>Practice set</Title>
      <Caption>Questions made from this session to test yourself.</Caption>

      {hasText ? (
        <>
          <Caption>Anything to focus on?</Caption>
          <TextInput
            accessibilityLabel="Anything to focus on?"
            multiline
            value={focus}
            onChangeText={(next) => setFocus(next.slice(0, JOB_PROMPT_MAX_CHARS))}
            maxLength={JOB_PROMPT_MAX_CHARS}
            style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
          />
          <Caption>{`${focus.length}/${JOB_PROMPT_MAX_CHARS}`}</Caption>
        </>
      ) : (
        <Caption>This session has no text yet.</Caption>
      )}

      <QuoteBox state={quote} {...(hasText ? { onShowSent: () => setShowSent((v) => !v) } : {})} />
      {showSent && hasText ? (
        <ScrollView style={[styles.sent, { backgroundColor: colors.surface2 }]} nestedScrollEnabled>
          <Text style={[styles.sentText, { color: colors.ink3 }]}>{text}</Text>
        </ScrollView>
      ) : null}

      {copy !== null ? (
        <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
          <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{copy.title}</Text>
          <Text style={[styles.boxBody, { color: colors.flagInk }]}>{copy.body}</Text>
        </View>
      ) : null}

      {hasText ? (
        <PrimaryButton
          label={price === null ? "Make" : `Make · ${creditsLabel(price)}`}
          icon="list.bullet.clipboard"
          onPress={() => void start()}
        />
      ) : null}
      {copy !== null
        ? copy.actions
            .filter((action) => ACTION_LABELS[action] !== undefined)
            .map((action) => <SecondaryButton key={action} label={ACTION_LABELS[action] ?? ""} onPress={() => act(action)} />)
        : null}
    </Screen>
  );
}

function CircleButton({ label, icon, onPress }: { label: string; icon: "chevron.left"; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name={icon} tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row" },
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 96, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 17, lineHeight: 24, textAlignVertical: "top" },
  sent: { maxHeight: 220, borderRadius: 12, padding: 12 },
  sentText: { fontSize: 14, lineHeight: 20 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
