// The shape of a shared item (SharedItemSchema in packages/contracts/src/shared.ts), checked by hand so the page
// does not load zod. test/item.test.ts keeps the two in step.
export type SharedItem = {
  v: 1;
  kind: "session";
  title: string;
  created_at: number;
  transcript: { t: number; text: string }[];
  pages: { text: string }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Obj, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max;

export function checkSharedItem(value: unknown): SharedItem | null {
  if (!isObj(value) || !only(value, ["v", "kind", "title", "created_at", "transcript", "pages"])) return null;
  if (value.v !== 1 || value.kind !== "session" || !str(value.title, 1, 200) || !isInt(value.created_at)) return null;
  const { transcript, pages } = value;
  if (!Array.isArray(transcript) || transcript.length > 20_000 || !Array.isArray(pages) || pages.length > 200) return null;
  for (const line of transcript) if (!isObj(line) || !only(line, ["t", "text"]) || !isInt(line.t) || !str(line.text, 0, 10_000)) return null;
  for (const page of pages) if (!isObj(page) || !only(page, ["text"]) || !str(page.text, 0, 50_000)) return null;
  return { v: 1, kind: "session", title: value.title, created_at: value.created_at, transcript: transcript as SharedItem["transcript"], pages: pages as SharedItem["pages"] };
}
