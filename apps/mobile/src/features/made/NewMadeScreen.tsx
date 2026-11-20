import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { JOB_PROMPT_MAX_CHARS } from "@waypoint/contracts";
import { failureCopy, keepsKey, type CloudFailure, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel } from "../../core/config/config.ts";
import type { MadeKind } from "../../core/made/made.ts";
import { keyForRequest } from "../../core/research/research.ts";
import { useConfig } from "../../platform/config.ts";
import { useQuote } from "../../platform/jobs.ts";
import { madeText, startMade } from "../../platform/made.ts";
import { Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { QuoteBox } from "../../ui/QuoteBox.tsx";
import { useColors } from "../../ui/theme.ts";

// Makes a practice set (M25a), a diagram or a mini app (M25b) from one session, with an optional focus and the price
// from the quote. Opened from a session (sessionId and kind). The result is saved when the job's result opens.
const KIND_COPY: Record<MadeKind, { title: string; caption: string; icon: SFSymbol }> = {
  practice: { title: "Practice set", caption: "Questions made from this session to test yourself.", icon: "list.bullet.clipboard" },
  diagram: { title: "Diagram", caption: "A diagram of this session. It is drawn on this iPhone.", icon: "point.3.connected.trianglepath.dotted" },
  mini_app: {
    title: "Mini app",
    caption: "A small app made from this session. It can't use the internet or see anything else on your iPhone.",
    icon: "square.grid.2x2",
  },
};

function kindOf(value: string | undefined): MadeKind {
  return value === "diagram" || value === "mini_app" ? value : "practice";
}

const ACTION_LABELS: Partial<Record<FailureAction, string>> = {
  try_again: "Try again",
  get_credits: "Get credits",
  approve_device: "Set up this iPhone",
  close: "Close",
};

export default function NewMadeScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId?: string; kind?: string }>();
  const sessionId = params.sessionId ?? null;
  const kind = kindOf(params.kind);
  const miniAppsOn = useConfig()?.flags.mini_app_viewer === true;
  const diagramsOn = useConfig()?.flags.diagram_viewer === true;
  const available = (kind !== "mini_app" || miniAppsOn) && (kind !== "diagram" || diagramsOn);
  const [focus, setFocus] = useState("");
  const [showSent, setShowSent] = useState(false);
  // The last failed request that may be re-sent (keepsKey), with its key and body. "Try again" reuses the key only
  // while the body is unchanged (keyForRequest).
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<CloudFailure | null>(null);
  const quote = useQuote(available ? { task: kind } : null);
  const price = quote.quote?.credits ?? null;
  const text = sessionId !== null ? madeText(sessionId, kind) : "";
  const hasText = text !== "";

  async function start(): Promise<void> {
    if (sessionId === null || !hasText || !available || price === null || starting) return;
    setStarting(true);
    setFailure(null);
    const prompt = focus.trim() === "" ? null : focus.trim();
    const body = JSON.stringify({ kind, sessionId, text, prompt });
    const key = keyForRequest(attempt.current, body, () => randomUUID());
    const result = await startMade(kind, sessionId, key, prompt);
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
      <Title>{KIND_COPY[kind].title}</Title>
      <Caption>{KIND_COPY[kind].caption}</Caption>

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
          {focus.trim() !== "" ? <Text style={[styles.sentText, { color: colors.ink3 }]}>{`Focus: ${focus.trim()}`}</Text> : null}
        </ScrollView>
      ) : null}

      {copy !== null ? (
        <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
          <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{copy.title}</Text>
          <Text style={[styles.boxBody, { color: colors.flagInk }]}>{copy.body}</Text>
        </View>
      ) : null}

      {!available ? <Caption>{kind === "diagram" ? "Diagrams aren't available yet." : "Mini apps aren't available yet."}</Caption> : null}
      {hasText && available ? (
        <PrimaryButton
          label={price === null ? "Make" : `Make · ${creditsLabel(price)}`}
          icon={KIND_COPY[kind].icon}
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
