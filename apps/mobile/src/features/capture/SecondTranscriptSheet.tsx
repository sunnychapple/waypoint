import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, keepsKey, type CloudFailure, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel } from "../../core/config/config.ts";
import { countLabel } from "../../core/format.ts";
import { bytesLabel } from "../../core/settings/format.ts";
import { useQuote } from "../../platform/jobs.ts";
import { MAX_SECOND_MINUTES, secondPlan, startSecondTranscript } from "../../platform/second.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { QuoteBox } from "../../ui/QuoteBox.tsx";
import { useColors } from "../../ui/theme.ts";

const ACTION_LABELS: Record<FailureAction, string> = {
  try_again: "Try again",
  get_credits: "Get credits",
  ask_later: "Ask later",
  approve_device: "Set up this iPhone",
  close: "Close",
};

// The second transcript sheet: what leaves the phone, the price from the quote, and the one tap that sends it.
export default function SecondTranscriptSheet() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [plan] = useState(() => secondPlan(sessionId));
  const tooLong = plan !== null && plan.minutes > MAX_SECOND_MINUTES;
  const offered = plan !== null && plan.complete && !tooLong;
  const quote = useQuote(offered ? { task: "retranscribe", minutes: plan.minutes } : null);
  // Made once when the sheet opens; "Try again" re-sends with it only when the request did not run (keepsKey).
  const [key, setKey] = useState(() => randomUUID());
  const [failure, setFailure] = useState<CloudFailure | null>(null);
  const busy = useRef(false);

  function showSent() {
    if (plan === null) return;
    Alert.alert("What's sent", `${countLabel(plan.minutes, "minute", "minutes")} of audio in ${countLabel(plan.parts, "part", "parts")} (${bytesLabel(plan.bytes)}).`);
  }

  async function send(): Promise<void> {
    if (plan === null || busy.current) return;
    busy.current = true;
    setFailure(null);
    const result = await startSecondTranscript(sessionId, key);
    busy.current = false;
    if (result.ok) {
      router.back();
      router.push(`/job/${result.jobId}`);
      return;
    }
    if (!keepsKey(result.failure)) setKey(randomUUID());
    setFailure(result.failure);
  }

  function act(action: FailureAction): void {
    if (action === "try_again") void send();
    else if (action === "get_credits" && failure?.kind === "out_of_credits") router.push(`/plans?need=${failure.shortfall}`);
    else if (action === "approve_device") router.push("/device-waiting");
    else router.back();
  }

  return (
    <Screen>
      <Title>Better transcript</Title>

      {plan === null ? <Body>This session has no recording.</Body> : null}
      {tooLong ? <Body>This recording is too long for a second transcript.</Body> : null}
      {plan !== null && !plan.complete ? <Body>This recording's audio isn't on this iPhone.</Body> : null}

      {offered ? (
        <>
          <Body style={[styles.first, { color: colors.ink }]}>
            {"Your recording's audio will be sent to NotePath's cloud for this one job, and deleted when it ends."}
          </Body>
          <Caption>{"A second, more careful transcript. Words that differ from this iPhone's transcript are highlighted."}</Caption>

          <QuoteBox state={quote} onShowSent={showSent} />

          {failure !== null ? (
            <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
              <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{failureCopy(failure).title}</Text>
              <Text style={[styles.boxBody, { color: colors.flagInk }]}>{failureCopy(failure).body}</Text>
            </View>
          ) : null}

          {failure !== null
            ? failureCopy(failure)
                .actions.filter((action) => action !== "ask_later")
                .map((action, index) =>
                  index === 0 ? (
                    <PrimaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
                  ) : (
                    <SecondaryButton key={action} label={ACTION_LABELS[action]} onPress={() => act(action)} />
                  ),
                )
            : quote.quote !== null
              ? <PrimaryButton label={`Send audio · ${creditsLabel(quote.quote.credits)}`} onPress={() => void send()} />
              : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  first: { fontWeight: "700" },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
