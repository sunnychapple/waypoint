// Runs a group's key step once when the room says its keys are needed, however many messages come in a burst. A message
// while a run is pending joins it; one that arrives while a run is going runs the step once more after it. Timers only:
// no socket and no notes here, so it is tested with fake timers.
export const KEY_NUDGE_DELAY_MS = 1_000;

export function createKeyNudger(run: (groupId: string) => Promise<void>, delayMs: number = KEY_NUDGE_DELAY_MS): { nudge(groupId: string): void } {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  const again = new Set<string>();

  const start = (groupId: string): void => {
    running.add(groupId);
    Promise.resolve()
      .then(() => run(groupId))
      .catch(() => undefined)
      .finally(() => {
        running.delete(groupId);
        if (again.delete(groupId)) schedule(groupId);
      });
  };

  const schedule = (groupId: string): void => {
    if (pending.has(groupId)) return;
    pending.set(
      groupId,
      setTimeout(() => {
        pending.delete(groupId);
        if (running.has(groupId)) again.add(groupId);
        else start(groupId);
      }, delayMs),
    );
  };

  return { nudge: schedule };
}
