import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "vectors");

export function readVectors<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTORS_DIR, name), "utf8")) as T;
}
