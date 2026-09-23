// Test-suite counts shown on the site, computed from the repository at build time so they are
// never hand-typed and never stale. Mirrors tests/harness/discover.ts: a directory holding
// `main.ts` is one multi-file program, and only the first 10 lines carry annotations.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

function programs(dir: string): string[] {
  const entries = readdirSync(dir);
  if (entries.includes("main.ts")) return [join(dir, "main.ts")];
  const out: string[] = [];
  for (const e of entries) {
    if (e === "node_modules") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...programs(full));
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const head = (path: string): string => readFileSync(path, "utf8").split("\n", 10).join("\n");

export interface SuiteStats {
  differential: number; // programs diffed against Node at -O0 and -O2 (fixtures, examples, docs)
  knownBugs: number; // fixtures that must keep diverging until fixed
  rejections: number; // programs that must fail with a specific CS code
  fuzzers: number; // seeded differential fuzzers in tests/slow
  codes: number; // CS#### codes in the validator's table
}

declare const data: SuiteStats;
export { data };

export default {
  watch: ["../tests/fixtures/**", "../examples/**", "./examples/**", "../src/validate/codes.ts"],
  load(): SuiteStats {
    const run = programs(join(repo, "tests", "fixtures", "run"));
    const knownBugs = run.filter((p) => /@known-bug:/.test(head(p))).length;
    const docs = programs(join(repo, "docs", "examples")).filter(
      (p) => !/@expect-reject:|@native-only:/.test(head(p)),
    );
    const examples = programs(join(repo, "examples"));
    const rejections = programs(join(repo, "tests", "fixtures", "reject")).filter((p) =>
      /@expect-reject:/.test(head(p)),
    ).length;
    const fuzzers = readdirSync(join(repo, "tests", "slow")).filter((f) =>
      /fuzz\.test\.ts$/.test(f),
    ).length;
    const codes = new Set(
      readFileSync(join(repo, "src", "validate", "codes.ts"), "utf8").match(/"CS\d{4}"/g) ?? [],
    ).size;
    return {
      differential: run.length - knownBugs + examples.length + docs.length,
      knownBugs,
      rejections,
      fuzzers,
      codes,
    };
  },
};
