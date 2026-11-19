import { z } from "zod";

export type Line = { text: string; x: number; y: number; width: number; height: number };
export type Block = { text: string; x: number; y: number; width: number; height: number; lines: number };

export const PROBLEM_START = /^\(?(\d{1,3}|[a-z])[.)]\s/i;

const LineSchema = z.object({
  text: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function sameRow(a: Line, b: Line): boolean {
  return Math.abs(a.y - b.y) <= Math.min(a.height, b.height) / 2;
}

// Groups a page's lines (already in reading order) into blocks a student can tap.
export function groupBlocks(lines: Line[]): Block[] {
  if (lines.length === 0) return [];
  const gapLimit = 1.2 * median(lines.map((l) => l.height));
  const groups: Line[][] = [];
  let current: Line[] = [];
  let previous: Line | undefined;
  for (const line of lines) {
    const first = current[0];
    const startsNew =
      first === undefined ||
      PROBLEM_START.test(line.text) ||
      (previous !== undefined && line.y - (previous.y + previous.height) > gapLimit) ||
      (first !== undefined && Math.abs(line.x - first.x) > 0.15 && !(previous !== undefined && sameRow(previous, line)));
    if (startsNew && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(line);
    previous = line;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group) => {
    const minX = Math.min(...group.map((l) => l.x));
    const minY = Math.min(...group.map((l) => l.y));
    const maxX = Math.max(...group.map((l) => l.x + l.width));
    const maxY = Math.max(...group.map((l) => l.y + l.height));
    return {
      text: group.map((l) => l.text).join(" "),
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      lines: group.length,
    };
  });
}

// captures.found_lines: bad or missing JSON gives []; items that do not match the shape are dropped.
export function parseLines(json: string | null): Line[] {
  if (json === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    const parsed = LineSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
