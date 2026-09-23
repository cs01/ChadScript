// The realistic-program corpus (tests/corpus/): programs written the way people write TypeScript,
// not tailored to the subset. Each one either behaves exactly like Node (every effect: stdout,
// stderr, exit code, files), or is rejected with a CS code. Anything else is a bug. This module
// classifies one program; the slow-lane test and scripts/scoreboard.ts both use it.

import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DiagnosticError } from "../../src/diagnostics.js";
import { differential } from "./differential.js";
import { discoverFixtures, type Fixture } from "./discover.js";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPUS_ROOT = join(REPO_ROOT, "tests", "corpus");

export type Outcome = "match" | "rejected" | "divergent" | "crash";

export interface Rejection {
  code: string;
  message: string;
}

export interface CorpusResult {
  path: string; // repo-relative, forward slashes
  category: string;
  knownBug: string | null;
  outcome: Outcome;
  rejections: Rejection[]; // every diagnostic, for `rejected`
  detail: string; // first divergence / crash line, for `divergent` and `crash`
  infra: boolean; // the Node oracle itself misbehaved: the program is broken, not the compiler
}

const CATEGORY_RE = /^\/\/\s*@category:\s*(\S+)/;

export function corpusPrograms(root = CORPUS_ROOT): Fixture[] {
  return discoverFixtures(root);
}

export function categoryOf(path: string): string {
  const first = readFileSync(path, "utf8").split("\n", 1)[0]!;
  const m = CATEGORY_RE.exec(first);
  if (!m) throw new Error(`${path}: first line must be \`// @category: <name>\``);
  return m[1]!;
}

export async function runCorpusProgram(fx: Fixture): Promise<CorpusResult> {
  const base = {
    path: relative(REPO_ROOT, fx.path).split("\\").join("/"),
    category: categoryOf(fx.path),
    knownBug: fx.knownBug,
    rejections: [] as Rejection[],
    detail: "",
    infra: false,
  };
  let divergences;
  try {
    divergences = await differential(fx.path, fx.args);
  } catch (e) {
    if (e instanceof DiagnosticError) {
      return {
        ...base,
        outcome: "rejected",
        rejections: e.diagnostics.map((d) => ({ code: d.code, message: d.message })),
      };
    }
    // Anything else thrown while compiling is the compiler failing: a CS9000 ICE, a stack
    // overflow, or clang refusing the emitted IR. For the last, the useful line is clang's
    // `error:` line, not the command line, and its temp path varies between runs.
    const msg = (e as Error).message;
    const clangError = msg.split("\n").find((l) => / error: /.test(l) && !l.startsWith("Command"));
    const detail = clangError ? `invalid IR: ${clangError.replace(/^.*? error: /, "")}` : msg;
    return { ...base, outcome: "crash", detail: firstLine(detail) };
  }
  if (divergences.length === 0) return { ...base, outcome: "match" };
  const infra = divergences.some((d) => d.kind === "infra");
  const crashed = divergences.find((d) => d.kind === "crash" || d.kind === "hang");
  const first = divergences.find((d) => d.kind === "infra") ?? crashed ?? divergences[0]!;
  return {
    ...base,
    outcome: crashed ? "crash" : "divergent",
    detail: `[${first.kind}] ${firstLine(first.detail)}`,
    infra,
  };
}

function firstLine(s: string): string {
  const line = s.split("\n", 1)[0]!;
  return line.length > 400 ? `${line.slice(0, 400)}...` : line;
}

// Bounded concurrency: each program spawns node plus two clang links.
export async function runCorpus(
  programs: Fixture[],
  onResult?: (r: CorpusResult) => void,
): Promise<CorpusResult[]> {
  const results: CorpusResult[] = new Array(programs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < programs.length) {
      const i = next++;
      results[i] = await runCorpusProgram(programs[i]!);
      onResult?.(results[i]!);
    }
  };
  const n = Math.min(Math.max(2, cpus().length), programs.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

// What a corpus result means for the build: null when acceptable, otherwise why it fails.
export function corpusFailure(r: CorpusResult): string | null {
  if (r.infra) return `${r.path}: the Node oracle itself failed (${r.detail}); fix the program`;
  if (r.knownBug !== null) {
    return r.outcome === "divergent" || r.outcome === "crash"
      ? null
      : `${r.path}: @known-bug program is now ${r.outcome}; remove the annotation`;
  }
  if (r.outcome === "divergent" || r.outcome === "crash")
    return `${r.path}: ${r.outcome} ${r.detail}`;
  return null;
}
