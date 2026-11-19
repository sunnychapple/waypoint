// Turns user text into an FTS5 query. Only letters and digits survive, each word is quoted,
// and the last word gets a prefix `*` so results narrow while the user is still typing.
export function toFtsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}]+/gu);
  if (!words || words.length === 0) return null;
  return words.map((word, i) => (i === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(" ");
}
