// The "type 3 words back" check (docs/security.md section 13). Positions are 0-based.
export function pickPositions(random: () => number): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(Math.min(11, Math.floor(random() * 12)));
  return [...picked].sort((a, b) => a - b);
}

export function normalizeWord(text: string): string {
  return text.trim().toLowerCase();
}

export function wordsMatch(words: string[], positions: number[], typed: string[]): boolean {
  return positions.length === typed.length && positions.every((p, i) => words[p] !== undefined && words[p] === normalizeWord(typed[i] ?? ""));
}

// What the person typed on the recovery screen, as one line of lowercase words.
export function cleanPhrase(text: string): string {
  return text.toLowerCase().split(/\s+/).filter((w) => w !== "").join(" ");
}

export function wordCount(text: string): number {
  return cleanPhrase(text) === "" ? 0 : cleanPhrase(text).split(" ").length;
}

// GET /v1/recovery, as the screens need it.
export type RecoveryState = "saved" | "unchecked" | "missing" | "unknown";

export function recoveryState(view: { verified_at: number | null } | null, failed: boolean): RecoveryState {
  if (failed) return "unknown";
  if (view === null) return "missing";
  return view.verified_at === null ? "unchecked" : "saved";
}
