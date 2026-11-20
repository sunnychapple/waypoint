import { useEffect, useState } from "react";
import { router } from "expo-router";
import { failureCopy, type CloudFailure } from "../../core/cloud/failure.ts";
import { getSetting } from "../../core/db/settings.ts";
import { SYNC_LIMIT_KEY, syncLimitCopy } from "../../core/sync/limit.ts";
import { useQuery } from "../../platform/db.ts";
import { buyMoreSync, recheckSyncLimit } from "../../platform/sync.ts";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

// Today's sync is used up (open question 55): add more for today with credits, or wait until it starts again.
export default function SyncLimitScreen() {
  const until = useQuery((db) => getSetting(db, SYNC_LIMIT_KEY));
  const againAt = until === null ? "tomorrow" : new Date(Number(until)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const copy = syncLimitCopy(againAt);
  const [busy, setBusy] = useState(false);
  // Opening the sheet clears the pause and sends once: the buy option shows only if the server answered 429 again.
  const [checked, setChecked] = useState(false);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    void recheckSyncLimit().then((stillWaiting) => {
      setWaiting(stillWaiting);
      setChecked(true);
    });
  }, []);
  const [failure, setFailure] = useState<CloudFailure | "price_changed" | null>(null);

  async function buy(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await buyMoreSync();
    setBusy(false);
    if (result === null) router.back();
    else setFailure(result);
  }

  // failureCopy's offline words are about questions for later; here nothing was charged, so say that.
  const problem =
    failure === null || failure === "price_changed"
      ? null
      : failure.kind === "offline"
        ? { title: "You're offline", body: "Connect to the internet, then try again." }
        : failureCopy(failure);
  if (checked && until === null) {
    return (
      <Screen>
        <Title>{waiting ? "Couldn't send yet" : "Sync is working again"}</Title>
        <Body>{waiting ? "Your notes stay on this iPhone and send when you're back online." : "Your notes are sending."}</Body>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>{copy.title}</Title>
      <Body>{copy.body}</Body>
      {failure === "price_changed" ? (
        <Body>{copy.priceChanged}</Body>
      ) : !checked ? (
        <Body>Checking…</Body>
      ) : (
        <PrimaryButton label={busy ? "Adding…" : copy.buy} icon="arrow.up.circle" onPress={() => void buy()} />
      )}
      {problem !== null ? <Body>{`${problem.title}. ${problem.body}`}</Body> : null}
      {failure !== null && failure !== "price_changed" && failure.kind === "out_of_credits" ? (
        <SecondaryButton label="Get credits" icon="creditcard" onPress={() => router.push(`/plans?need=${failure.shortfall}`)} />
      ) : null}
      <SecondaryButton label="Wait" onPress={() => router.back()} />
    </Screen>
  );
}
