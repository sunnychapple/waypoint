import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const CORE = join(SRC, "core");
const FEATURES = join(SRC, "features");
const CORE_PACKAGES = ["@waypoint/contracts", "zod", "ts-fsrs"];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "");
}

describe("folder rules", () => {
  it("src/core imports only src/core and plain packages", () => {
    for (const file of sourceFiles(CORE)) {
      for (const spec of importsOf(file)) {
        const where = `${relative(SRC, file)} imports ${spec}`;
        if (spec.startsWith(".")) expect(join(dirname(file), spec).startsWith(CORE + "/"), where).toBe(true);
        else expect(CORE_PACKAGES.includes(spec), where).toBe(true);
      }
    }
  });

  it("a feature never imports another feature", () => {
    for (const feature of existsSync(FEATURES) ? readdirSync(FEATURES) : []) {
      for (const file of sourceFiles(join(FEATURES, feature))) {
        for (const spec of importsOf(file).filter((s) => s.startsWith("."))) {
          const target = join(dirname(file), spec);
          if (target.startsWith(FEATURES + "/")) {
            expect(target.startsWith(join(FEATURES, feature) + "/"), `${relative(SRC, file)} imports ${spec}`).toBe(true);
          }
        }
      }
    }
  });
});
