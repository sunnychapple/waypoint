import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { dateLine, greeting } from "../../core/capture/labels.ts";
import { latestSession } from "../../core/capture/sessions.ts";
import { countLabel, formatClock } from "../../core/format.ts";
import { countDue } from "../../core/study/cards.ts";
import { minutesLabel } from "../../core/study/labels.ts";
import { useProfile } from "../../platform/auth.tsx";
import { useMinuteNow, useQuery } from "../../platform/db.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { SavingToPill } from "./SavingToPill.tsx";

const AVATAR = "#EE7B3B";

export default function HomeScreen() {
  const colors = useColors();
  const profile = useProfile();
  const latest = useQuery(latestSession);
  const now = useMinuteNow();
  const due = useQuery((db) => countDue(db, now), String(now));
  const offset = -new Date().getTimezoneOffset();
  const hello = greeting(new Date().getHours());

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Caption style={styles.caps}>{dateLine(Date.now(), offset)}</Caption>
          <Title>{profile ? `${hello}, ${profile.firstName}` : hello}</Title>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{profile?.initial ?? "?"}</Text>
        </Pressable>
      </View>

      {due > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{`${countLabel(due, "card", "cards")} due`}</Text>
          <Body>{minutesLabel(due)}</Body>
          <PrimaryButton label="Start" onPress={() => router.push("/study/review")} />
        </View>
      ) : null}

      {latest ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Caption>{latest.spaceName}</Caption>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{latest.title}</Text>
          <Body>{latest.kind === "recording" ? formatClock(latest.recordedMs) : countLabel(latest.pages, "page", "pages")}</Body>
          <View style={styles.chips}>
            {latest.flags > 0 ? <Chip label={countLabel(latest.flags, "flag", "flags")} tone="flag" /> : null}
            {latest.photos > 0 ? <Chip label={countLabel(latest.photos, "photo", "photos")} /> : null}
            {latest.pages > 0 ? <Chip label={countLabel(latest.pages, "page", "pages")} /> : null}
          </View>
          <SecondaryButton label="Open session" onPress={() => router.push(`/session/${latest.id}`)} />
        </View>
      ) : (
        <View style={styles.empty}>
          <Title style={styles.centered}>Start with a class or a page.</Title>
          <Body style={styles.centered}>Record what you hear, or snap homework and book pages.</Body>
        </View>
      )}

      <View style={styles.savingTo}>
        <Caption>Saving to</Caption>
        <SavingToPill />
      </View>

      <View style={styles.starts}>
        <StartTile
          label="Record"
          detail="A class or a talk"
          icon="mic.fill"
          fill={colors.rec}
          ink={colors.onRec}
          onPress={() => router.push("/record")}
        />
        <StartTile
          label="Snap pages"
          detail="Homework, books"
          icon="camera.fill"
          fill={colors.accent}
          ink={colors.onAccent}
          onPress={() => router.push("/pages/new")}
        />
      </View>
      <SecondaryButton label="From Photos" onPress={() => router.push("/pages/new?from=photos")} />
    </Screen>
  );
}

function Chip({ label, tone }: { label: string; tone?: "flag" }) {
  const colors = useColors();
  const fill = tone === "flag" ? colors.flagSoft : colors.surface2;
  const ink = tone === "flag" ? colors.flagInk : colors.ink2;
  return (
    <View style={[styles.chip, { backgroundColor: fill }]}>
      <Text style={[styles.chipText, { color: ink }]}>{label}</Text>
    </View>
  );
}

function StartTile({
  label,
  detail,
  icon,
  fill,
  ink,
  onPress,
}: {
  label: string;
  detail: string;
  icon: SFSymbol;
  fill: string;
  ink: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.tile, { backgroundColor: fill }]}>
      <SymbolView name={icon} tintColor={ink} size={28} />
      <Text style={[styles.tileTitle, { color: ink }]}>{label}</Text>
      <Text style={[styles.tileDetail, { color: ink }]}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerText: { flex: 1, gap: 6 },
  caps: { letterSpacing: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AVATAR,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  cardTitle: { fontFamily: "Georgia", fontSize: 22, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: "500" },
  empty: { gap: 12, paddingTop: 24 },
  centered: { textAlign: "center" },
  savingTo: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  starts: { flexDirection: "row", gap: 12 },
  tile: { flex: 1, minHeight: 130, borderRadius: 20, padding: 16, justifyContent: "space-between" },
  tileTitle: { fontSize: 20, fontWeight: "700" },
  tileDetail: { fontSize: 14, opacity: 0.85 },
});
