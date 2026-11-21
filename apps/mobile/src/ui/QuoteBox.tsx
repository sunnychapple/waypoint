import { Pressable, StyleSheet, Text, View } from "react-native";
import { creditsLabel } from "../core/config/config.ts";
import { failureCopy } from "../core/cloud/failure.ts";
import { useSignOut } from "../platform/auth.tsx";
import type { QuoteState } from "../platform/jobs.ts";
import { Caption, Row, SecondaryButton } from "./kit.tsx";
import { useColors } from "./theme.ts";

// "Before you run it": the price from the quote, what is kept, and what is sent (docs/architecture.md section 6).
// A failed quote shows its reason and, with onRetry, a "Try again" that asks for the quote again.
export function QuoteBox({ state, onShowSent, onRetry }: { state: QuoteState; onShowSent?: () => void; onRetry?: () => void }) {
  const colors = useColors();
  const { quote, failure } = state;
  const signOut = useSignOut();
  const copy = failure === null ? null : failureCopy(failure, "make");
  return (
    <View style={[styles.box, { backgroundColor: colors.surface2, borderColor: colors.line }]}>
      <Caption style={styles.caps}>BEFORE YOU RUN IT</Caption>
      {state.loading ? <Caption>Checking the price…</Caption> : null}
      {quote !== null ? (
        <>
          <Row title={creditsLabel(quote.credits)} right={<Caption>{`${quote.balance_after} left after`}</Caption>} />
          <Caption>{quote.retention === "zero" ? "Not stored in the cloud" : "Sent for this task only"}</Caption>
          {onShowSent !== undefined ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Show what's sent" onPress={onShowSent} style={styles.link}>
              <Text style={[styles.linkText, { color: colors.accent }]}>Show what's sent</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {failure !== null ? (
        <>
          <Text style={[styles.title, { color: colors.ink }]}>{copy?.title}</Text>
          <Caption>{copy?.body}</Caption>
          {copy?.signIn === true ? <SecondaryButton label="Sign in again" onPress={() => void signOut()} /> : null}
          {onRetry !== undefined && copy?.signIn !== true ? <SecondaryButton label="Try again" onPress={onRetry} /> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  caps: { letterSpacing: 0.5 },
  title: { fontSize: 17, fontWeight: "600" },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 15, fontWeight: "600" },
});
