// The on-device model takes one request at a time. A request the person asked for (flashcards, quiz, help) comes before
// the automatic summary: the summary stops at its next step and runs again later.
let waiting = 0;
export function personWaiting(): boolean { return waiting > 0; }
export async function asPerson<T>(run: () => Promise<T>): Promise<T> {
  waiting += 1;
  try {
    // The summary step that is running finishes first: retry "busy" for up to 8 seconds.
    const until = Date.now() + 8_000;
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
  }
}
