import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { creditsLabel, priceNote } from "../../core/config/config.ts";
import { balanceSummary, buyMessage, needLine, ownsOwnIt, restoreMessage } from "../../core/store/plans.ts";
import { useConfig } from "../../platform/config.ts";
import { buy, loadProducts, restorePurchases, type ShopProduct } from "../../platform/store.ts";
import { useWallet } from "../../platform/wallet.ts";
import { BackButton, Body, Caption, OnDeviceNote, PrimaryButton, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const BANNER_MS = 4000;

function PricePill({ price }: { price: string }) {
  const colors = useColors();
  return (
    <View style={[styles.pill, { backgroundColor: colors.accentSoft }]}>
      <Text style={[styles.pillText, { color: colors.accent }]}>{price}</Text>
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.textButton}>
      <Text style={[styles.textButtonText, { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

// Plans & credits (/plans, optional ?need=<shortfall> from Explain's "Get credits"): balance, credit packs, Plus, Own it.
export default function PlansScreen() {
  const colors = useColors();
  const { need } = useLocalSearchParams<{ need?: string }>();
  const { wallet, error, reload } = useWallet();
  const config = useConfig();
  const [products, setProducts] = useState<ShopProduct[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string } | null>(null);
  // Set after a purchase made from a task that ran out of credits: credits added, waiting for Continue.
  const [added, setAdded] = useState<number | null>(null);
  const mounted = useRef(true);
  const continued = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadProducts().then(
      (found) => {
        if (live) setProducts(found);
      },
      () => {
        if (live) setProducts([]);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (banner === null) return;
    const timer = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  async function purchase(product: ShopProduct) {
    if (buying !== null) return;
    setBuying(product.id);
    try {
      const result = await buy(product.info.id);
      const needed = needLine(need) !== null;
      // Opened from a task that ran out of credits: once they are granted, confirm here and let the person go back
      // to that task with Continue. Nothing is run again. Only if this screen is still open (leaving mid-purchase
      // must not change the screen underneath).
      if (result.kind === "granted" && needed && result.reply.credits > 0 && mounted.current && router.canGoBack()) {
        setAdded(result.reply.credits);
        return;
      }
      const text = buyMessage(result.kind, result.kind === "granted" ? result.reply.credits : 0, needed);
      if (text !== null) setBanner({ text });
    } catch {
      setBanner({ text: buyMessage("failed", 0) ?? "" });
    } finally {
      setBuying(null);
      reload();
    }
  }

  async function restore() {
    try {
      const count = await restorePurchases();
      setBanner({ text: restoreMessage(count) });
    } catch {
      setBanner({ text: "Couldn't restore purchases. Try again." });
    }
    reload();
  }

  const summary = wallet ? balanceSummary(wallet, -new Date().getTimezoneOffset()) : null;
  const line = needLine(need);
  const packs = products?.filter((p) => p.info.kind === "pack") ?? [];
  const plusProducts = products?.filter((p) => p.info.kind === "plus") ?? [];
  const ownItProducts = products?.filter((p) => p.info.kind === "own_it") ?? [];
  const hasPlus = wallet?.plan === "plus";
  const hasOwnIt = wallet !== null && ownsOwnIt(wallet);

  let balance: ReactNode;
  if (summary) {
    balance = (
      <>
        <Text style={[styles.total, { color: colors.ink }]}>{summary.total}</Text>
        <Caption>{summary.detail}</Caption>
        {summary.renews ? <Caption>{summary.renews}</Caption> : null}
        {summary.owed ? <Text style={[styles.owed, { color: colors.danger }]}>{summary.owed}</Text> : null}
      </>
    );
  } else if (error === "offline") {
    balance = <Body>Can't show your balance offline.</Body>;
  } else if (error === "failed") {
    balance = (
      <>
        <Body>Couldn't load your balance.</Body>
        <TextButton label="Try again" onPress={reload} />
      </>
    );
  } else {
    balance = <ActivityIndicator color={colors.accent} />;
  }

  function priceOrSpinner(product: ShopProduct): ReactNode {
    return buying === product.id ? <ActivityIndicator color={colors.accent} /> : <PricePill price={product.displayPrice} />;
  }

  let catalogue: ReactNode;
  if (products === null) {
    catalogue = <ActivityIndicator color={colors.accent} />;
  } else if (products.length === 0) {
    catalogue = <Body>Purchases aren't available right now.</Body>;
  } else {
    catalogue = (
      <>
        {packs.length > 0 ? (
          <>
            <Caption style={styles.section}>CREDIT PACKS</Caption>
            {packs.map((p) => (
              <Row
                key={p.id}
                title={creditsLabel(p.info.credits)}
                subtitle="Yours to keep. They never expire."
                right={priceOrSpinner(p)}
                onPress={() => void purchase(p)}
              />
            ))}
            <Caption>{priceNote(config)}</Caption>
          </>
        ) : null}

        {hasPlus || plusProducts.length > 0 ? (
          <>
            <Caption style={styles.section}>PLUS</Caption>
            {hasPlus ? (
              <Row
                title="You have Plus"
                subtitle="2,000 credits every month, “Don't keep my text”, and audio and photo sync"
                right={<Text style={[styles.textButtonText, { color: colors.accent }]}>Manage</Text>}
                onPress={() => void Linking.openURL(SUBSCRIPTIONS_URL).catch(() => undefined)}
              />
            ) : (
              plusProducts.map((p) => (
                <Row
                  key={p.id}
                  title={p.info.period === "yearly" ? "Plus yearly" : "Plus monthly"}
                  subtitle="2,000 credits every month, “Don't keep my text”, and audio and photo sync"
                  right={priceOrSpinner(p)}
                  onPress={() => void purchase(p)}
                />
              ))
            )}
          </>
        ) : null}

        {hasOwnIt || ownItProducts.length > 0 ? (
          <>
            <Caption style={styles.section}>OWN IT</Caption>
            {hasOwnIt ? (
              <Row title="You own it" subtitle="2,000 credits came with it, once." />
            ) : (
              ownItProducts.map((p) => (
                <Row
                  key={p.id}
                  title="Own it"
                  subtitle="2,000 credits once, and audio and photo sync. Pay once."
                  right={priceOrSpinner(p)}
                  onPress={() => void purchase(p)}
                />
              ))
            )}
          </>
        ) : null}
      </>
    );
  }

  return (
    <Screen>
      <BackButton />
      <Title>Plans & credits</Title>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>{balance}</View>

      {banner ? (
        <View style={[styles.box, { backgroundColor: colors.surface2 }]}>
          <Body>{banner.text}</Body>
        </View>
      ) : null}

      {added !== null ? (
        <View style={[styles.box, { backgroundColor: colors.surface2 }]}>
          <Body>{buyMessage("granted", added)}</Body>
          <PrimaryButton
            label="Continue"
            onPress={() => {
              // A second tap before the screen closes must not also pop the task underneath.
              if (continued.current) return;
              continued.current = true;
              if (router.canGoBack()) router.back();
            }}
            style={styles.continue}
          />
        </View>
      ) : null}

      {line && added === null ? (
        <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
          <Body style={{ color: colors.flagInk }}>{line}</Body>
        </View>
      ) : null}

      {added === null ? catalogue : null}

      <TextButton label="Restore purchases" onPress={() => void restore()} />

      <Caption>
        Plus renews automatically until you cancel it in Settings › Apple Account › Subscriptions. Payment is charged to your Apple Account.
      </Caption>
      <OnDeviceNote text="Recording, pages, flashcards, quizzes and search are free and stay on this iPhone. Credits are only for the cloud." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  total: { fontSize: 28, fontWeight: "700" },
  owed: { fontSize: 13 },
  box: { padding: 14, borderRadius: 16 },
  continue: { marginTop: 12 },
  section: { marginTop: 8, letterSpacing: 0.5 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 15, fontWeight: "600" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  textButtonText: { fontSize: 17, fontWeight: "600" },
});
