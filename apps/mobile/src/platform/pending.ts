import { useEffect, useState } from "react";
import { PENDING_GIVE_UP_MS, pendingText, type Pending } from "../core/study/pending.ts";
import { useQuery } from "./db.ts";

// What the session still waits for, and what it gave up on. A page that never reads or a transcript that never
// finishes (no speech pack, a failed run) must not keep the student waiting: after a minute the wait ends,
// `pending` is null, and `skipped` says what is missing so the screen can tell them.
export function usePendingText(sessionId: string | null): { pending: Pending | null; skipped: Pending | null } {
  const actual = useQuery((db) => (sessionId === null ? null : pendingText(db, sessionId)), sessionId ?? "");
  const [gaveUp, setGaveUp] = useState(false);
  const waiting = actual !== null;

  useEffect(() => {
    if (!waiting) {
      setGaveUp(false);
      return;
    }
    const timer = setTimeout(() => setGaveUp(true), PENDING_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [waiting, sessionId]);

  return gaveUp && actual !== null ? { pending: null, skipped: actual } : { pending: actual, skipped: null };
}
