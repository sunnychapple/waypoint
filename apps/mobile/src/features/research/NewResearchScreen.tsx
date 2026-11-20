import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { JOB_PROMPT_MAX_CHARS, type ResearchDepth } from "@waypoint/contracts";
import { failureCopy, keepsKey, type CloudFailure, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel } from "../../core/config/config.ts";
import { keyForRequest, notesForResearch, researchRequest } from "../../core/research/research.ts";
import { getDb } from "../../platform/db.ts";
import { useQuote } from "../../platform/jobs.ts";
import { startResearch } from "../../platform/research.ts";
import { Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { QuoteBox } from "../../ui/QuoteBox.tsx";

// "Research the web": a question, a depth and the price from the quote, then the job (M19). Opened from a session
// (sessionId) or from Explain (q prefills the question).
const DEPTHS: { depth: ResearchDepth; title: string; subtitle: string }[] = [
  { depth: "quick", title: "Quick", subtitle: "A short answer from a few pages" },
  { depth: "standard", title: "Standard", subtitle: "A fuller answer from more pages" },
  { depth: "deep", title: "Deep", subtitle: "A careful answer from many pages" },
];

const ACTION_LABELS: Partial<Record<FailureAction, string>> = {
  try_again: "Try again",
  get_credits: "Get credits",
  approve_device: "Set up this iPhone",
  close: "Close",
};

export default function NewResearchScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId?: string; q?: string }>();
  const sessionId = params.sessionId ?? null;
  const [question, setQuestion] = useState(() => (params.q ?? "").slice(0, JOB_PROMPT_MAX_CHARS));
  const [depth, setDepth] = useState<ResearchDepth>("quick");
  const [withNotes, setWithNotes] = useState(false);
  const [showSent, setShowSent] = useState(false);
  // The last failed request that may be re-sent (keepsKey), with its key and body. "Try again" reuses the key only
  // while the body is unchanged (keyForRequest).
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<CloudFailure | null>(null);
  const quote = useQuote({ task: "research", depth });
  const trimmed = question.trim();
  const price = quote.quote?.credits ?? null;

  // The session's notes as they are sent, or null. "Show what's sent" and the request read the same function.
  function notesOrNull(): string | null {
    return withNotes && sessionId !== null ? notesForResearch(getDb(), sessionId) : null;
  }

  async function start(): Promise<void> {
    if (trimmed === "" || price === null || starting) return;
    setStarting(true);
    setFailure(null);
    const request = researchRequest({ question: trimmed, depth, notes: notesOrNull() });
    const body = JSON.stringify(request);
    const key = keyForRequest(attempt.current, body, () => randomUUID());
    const result = await startResearch({ request, sessionId, key });
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
  const notes = withNotes && sessionId !== null ? notesOrNull() : null;

  return (
    <Screen>
      <View style={styles.topRow}>
        <CircleButton label="Back" icon="chevron.left" onPress={() => router.back()} />
      </View>
      <Title>Research the web</Title>

      <Caption>Your question</Caption>
      <TextInput
        accessibilityLabel="Your question"
        multiline
        value={question}
        onChangeText={(text) => setQuestion(text.slice(0, JOB_PROMPT_MAX_CHARS))}
        maxLength={JOB_PROMPT_MAX_CHARS}
        style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
      />
      <Caption>{`${question.length}/${JOB_PROMPT_MAX_CHARS}`}</Caption>

      <View style={styles.block}>
        {DEPTHS.map((choice) => (
          <Row
            key={choice.depth}
            title={choice.title}
            subtitle={choice.subtitle}
            selected={depth === choice.depth}
            onPress={() => setDepth(choice.depth)}
          />
        ))}
      </View>

      {sessionId !== null ? (
        <View style={styles.block}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchText, { color: colors.ink }]}>Include my notes from this session</Text>
            <Switch
              accessibilityLabel="Include my notes from this session"
              value={withNotes}
              onValueChange={(on) => {
                setWithNotes(on);
                if (!on) setShowSent(false);
              }}
            />
          </View>
          {withNotes ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)} style={styles.link}>
                <Text style={[styles.linkText, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
              </Pressable>
              {showSent ? (
                <ScrollView style={[styles.sent, { backgroundColor: colors.surface2 }]} nestedScrollEnabled>
                  <Text style={[styles.sentText, { color: colors.ink3 }]}>{notes ?? ""}</Text>
                </ScrollView>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      <QuoteBox state={quote} />

      {copy !== null ? (
        <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
          <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{copy.title}</Text>
          <Text style={[styles.boxBody, { color: colors.flagInk }]}>{copy.body}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label={price === null ? "Research" : `Research · ${creditsLabel(price)}`}
        icon="globe"
        onPress={() => void start()}
      />
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
  block: { gap: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchText: { flex: 1, fontSize: 16 },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 15, fontWeight: "600" },
  sent: { maxHeight: 220, borderRadius: 12, padding: 12 },
  sentText: { fontSize: 14, lineHeight: 20 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
