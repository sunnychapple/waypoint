import { useEffect } from "react";
import { AppState } from "react-native";
import { markStale, sessionsToIndex, indexSession, type Embedder } from "../core/search/indexer.ts";
import { embed, getModel } from "../../modules/waypoint-embed/index.ts";
import { getDb, writeDb } from "./db.ts";

const TICK_MS = 20_000;
const SESSIONS_PER_TICK = 3;

let ticking = false;
let staleChecked = false;

// One pass: mark stale vectors once per launch, then index up to three sessions, one at a time.
// Errors are swallowed; the next tick tries again.
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const model = getModel();
    if (!model.available) return;
    const embedder: Embedder = { modelVersion: model.modelVersion, embed };
    const db = getDb();
    if (!staleChecked) {
      writeDb((d) => markStale(d, model.modelVersion));
      staleChecked = true;
    }
    for (const sessionId of sessionsToIndex(db, SESSIONS_PER_TICK)) {
      await indexSession(db, embedder, sessionId, Date.now());
      // indexSession writes straight to the database; writeDb tells the screens to re-read.
      writeDb(() => undefined);
    }
  } catch {
    // retried on the next tick
  } finally {
    ticking = false;
  }
}

// Runs the indexer while the app is active: on becoming active, then every 20 seconds.
export function useIndexer(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer !== null) return;
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
    };
    const stop = (): void => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    if (AppState.currentState === "active") start();
    return () => {
      stop();
      subscription.remove();
    };
  }, []);
}
