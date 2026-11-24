// The on-device model takes one request at a time. A request the person asked for (flashcards, quiz, help) comes before
// the automatic summary: the summary stops at its next step and runs again later.
let waiting = 0;
const whenFree = new Set<() => void>();
export function personWaiting(): boolean { return waiting > 0; }
// Called each time the last request the person was waiting for ends, so a summary that stopped for it runs again.
export function onModelFree(listener: () => void): () => void {
  whenFree.add(listener);
  return () => whenFree.delete(listener);
}
export async function asPerson<T>(run: () => Promise<T>): Promise<T> {
  waiting += 1;
  try {
    // The summary step that is running finishes first (one step can take a while on an older iPhone): retry "busy" for up
    // to 30 seconds. Nothing waits unless the model said busy.
    const until = Date.now() + 30_000;
    for (;;) {
      try {
        return await run();
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        if (code !== "busy" || Date.now() > until) throw error;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  } finally {
    waiting -= 1;
    if (waiting === 0) for (const listener of [...whenFree]) listener();
  }
}
