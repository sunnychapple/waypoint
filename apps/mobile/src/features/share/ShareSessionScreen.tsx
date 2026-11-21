import { useState } from "react";
import { Alert, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinkPasscodeSchema } from "@waypoint/contracts";
import { shortDay } from "../../core/format.ts";
import { linksForSession, type LinkExpiry, type LinkRow } from "../../core/share/links.ts";
import { dbGeneration, useQuery } from "../../platform/db.ts";
import { createLink, linkFailureText, revokeLink } from "../../platform/links.ts";
import { syncLimitHit } from "../../platform/sync.ts";
import { BackButton, Body, Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const EXPIRY_CHOICES: { value: LinkExpiry; label: string }[] = [
  { value: "none", label: "No expiry" },
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
];

const isActive = (link: LinkRow, now: number): boolean => link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now);

// Share a link to one session (M30b): a passcode switch, expiry choices, Make link, then the URL with Share (the
// share sheet has Copy), and the links already made with Turn off.
export default function ShareSessionScreen() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const links = useQuery((db) => linksForSession(db, sessionId), sessionId);
  const [passcodeOn, setPasscodeOn] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [expiry, setExpiry] = useState<LinkExpiry>("none");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; cut: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function makeLink() {
    if (busy) return;
    setError(null);
    if (passcodeOn && !LinkPasscodeSchema.safeParse(passcode).success) {
      setError("A passcode is 4 to 64 characters, with no spaces.");
      return;
    }
    setBusy(true);
    const generation = dbGeneration();
    try {
      setMade(await createLink(sessionId, { passcode: passcodeOn ? passcode : null, expiry }));
    } catch (failure) {
      // Today's sync is used up (open question 55): the sheet offers more for today.
      if (syncLimitHit(failure, generation)) router.push("/sync-limit");
      else setError(linkFailureText(failure, "make"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(link: LinkRow) {
    setError(null);
    try {
      await revokeLink(link.id);
    } catch (failure) {
      setError(linkFailureText(failure, "turn_off"));
    }
  }

  function share(url: string) {
    Share.share({ url }).catch(() => Alert.alert("Couldn't open the share sheet"));
  }

  const now = Date.now();
  const active = links.filter((link) => isActive(link, now));

  return (
    <Screen>
      <BackButton />
      <Title>Share a link</Title>
      <Body>
        Anyone with the link can read this session's transcript and page text in a web browser. They can't change it or see anything else.
      </Body>

      <Row
        title="Passcode"
        right={<Switch value={passcodeOn} onValueChange={setPasscodeOn} accessibilityLabel="Passcode" />}
      />
      {passcodeOn ? (
        <TextInput
          accessibilityLabel="Passcode text"
          value={passcode}
          onChangeText={setPasscode}
          placeholder="4 to 64 characters"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
          style={[styles.input, { color: colors.ink, borderColor: colors.line }]}
        />
      ) : null}

      <Caption>Expires</Caption>
      {EXPIRY_CHOICES.map((choice) => (
        <Row
          key={choice.value}
          title={choice.label}
          selected={expiry === choice.value}
          onPress={() => setExpiry(choice.value)}
        />
      ))}

      <PrimaryButton label={busy ? "Making link…" : "Make link"} onPress={() => void makeLink()} />

      {error !== null ? <Text style={[styles.error, { color: colors.ink }]}>{error}</Text> : null}

      {made !== null ? (
        <View style={styles.block}>
          <Caption>Your link</Caption>
          <Text selectable style={[styles.url, { color: colors.ink }]}>{made.url}</Text>
          {made.cut ? <Caption>This session was too long for one link; the link has the first part.</Caption> : null}
          <SecondaryButton label="Share…" icon="square.and.arrow.up" tone="accent" onPress={() => share(made.url)} />
        </View>
      ) : null}

      {active.length > 0 ? <Caption>Links for this session</Caption> : null}
      {active.map((link) => (
        <Row
          key={link.id}
          title={link.hasPasscode ? "Passcode link" : "Link"}
          subtitle={link.expiresAt === null ? "No expiry" : `Expires ${shortDay(link.expiresAt)}`}
          right={
            <View style={styles.actions}>
              <SecondaryButton label="Share…" icon="square.and.arrow.up" onPress={() => share(link.url)} />
              <SecondaryButton label="Turn off" onPress={() => void turnOff(link)} />
            </View>
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { marginTop: 8 },
  block: { gap: 8, marginTop: 12 },
  url: { fontSize: 13 },
  actions: { flexDirection: "row", gap: 8 },
});
