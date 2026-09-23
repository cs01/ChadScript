// Scoreboard: runs the realistic-program corpus (tests/corpus/) through the effects oracle and
// publishes the outcome as docs/generated/scoreboard.json plus the page docs/reference/scoreboard.md.
// The page is a pure function of the JSON (renderScoreboardMarkdown), so a fast unit test can check
// the committed page against the committed JSON without running the compiler.
//
//   bun run scripts/scoreboard.ts            run the corpus, write JSON + page, print every result
//   bun run scripts/scoreboard.ts --render   re-render the page from the committed JSON only
//   bun run scripts/scoreboard.ts --filter s run only programs whose path contains s; writes nothing

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusResult, Outcome } from "../tests/harness/corpus.js";

export interface ScoreboardReason {
  code: string;
  message: string; // normalized, see normalizeReason
  programs: number; // how many corpus programs hit it (each program counted once per reason)
  examples: string[]; // up to three program paths
}

export interface ScoreboardCategory {
  name: string;
  total: number;
  match: number;
  rejected: number;
  divergent: number;
  crash: number;
}

export interface Scoreboard {
  total: number;
  match: number;
  rejected: number;
  divergent: number;
  crash: number;
  categories: ScoreboardCategory[];
  reasons: ScoreboardReason[];
  programs: {
    path: string;
    category: string;
    outcome: Outcome;
    knownBug: string | null;
    detail: string;
  }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO = "https://github.com/cs01/ChadScript/blob/main/";
const JSON_PATH = join(here, "..", "docs", "generated", "scoreboard.json");
const PAGE_PATH = join(here, "..", "docs", "reference", "scoreboard.md");
const TOP_REASONS = 15;

// Group equivalent diagnostics: numbers (line numbers, counts) and long quoted type texts vary
// between programs without changing the reason; short quoted names ('error', 'readdirSync') are
// what tells one missing feature from another, so they stay.
export function normalizeReason(message: string): string {
  return message
    .split("\n", 1)[0]!
    .replace(/'[^']{25,}'/g, "'...'")
    .replace(/"[^"]{25,}"/g, '"..."')
    .replace(/\b\d+\b/g, "N")
    .trim();
}

export function buildScoreboard(results: CorpusResult[]): Scoreboard {
  const count = (rs: CorpusResult[], o: Outcome): number =>
    rs.filter((r) => r.outcome === o).length;
  const byCategory = new Map<string, CorpusResult[]>();
  for (const r of results) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const categories = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rs]) => ({
      name,
      total: rs.length,
      match: count(rs, "match"),
      rejected: count(rs, "rejected"),
      divergent: count(rs, "divergent"),
      crash: count(rs, "crash"),
    }));

  const reasons = new Map<string, ScoreboardReason>();
  for (const r of results) {
    if (r.outcome !== "rejected") continue;
    const seen = new Set<string>();
    for (const d of r.rejections) {
      const message = normalizeReason(d.message);
      const key = `${d.code} ${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = reasons.get(key) ?? { code: d.code, message, programs: 0, examples: [] };
      entry.programs++;
      if (entry.examples.length < 3) entry.examples.push(r.path);
      reasons.set(key, entry);
    }
  }
  return {
    total: results.length,
    match: count(results, "match"),
    rejected: count(results, "rejected"),
    divergent: count(results, "divergent"),
    crash: count(results, "crash"),
    categories,
    reasons: [...reasons.values()].sort(
      (a, b) =>
        b.programs - a.programs ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message),
    ),
    programs: results.map((r) => ({
      path: r.path,
      category: r.category,
      outcome: r.outcome,
      knownBug: r.knownBug,
      detail:
        r.outcome === "rejected"
          ? `${r.rejections[0]?.code ?? ""} ${normalizeReason(r.rejections[0]?.message ?? "")}`
          : r.detail,
    })),
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((100 * n) / total)}%`;
}

// Compiler messages as table cells, written as inline HTML so no markdown rule applies inside: a
// pipe would end the cell, a newline the table, `<` would open a tag, `{{` is Vue interpolation on
// the docs site (v-pre turns that off), and `*`, `_`, `[` would become emphasis or links.
// Backquoted spans in the message become <code>.
function cell(s: string): string {
  const escape = (t: string): string =>
    t
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[|*_[\]\\]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = s
    .replace(/\n/g, " ")
    .split("`")
    .map((part, i, all) =>
      // Odd parts sit between a pair of backquotes; an unpaired trailing one stays literal.
      i % 2 === 0
        ? escape(part)
        : i < all.length - 1
          ? `<code>${escape(part)}</code>`
          : `&#96;${escape(part)}`,
    )
    .join("");
  return `<span v-pre>${html}</span>`;
}

function programLink(path: string): string {
  const name = path.replace(/^tests\/corpus\//, "");
  return `[${name}](${REPO}${path})`;
}

export function renderScoreboardMarkdown(s: Scoreboard): string {
  const out: string[] = [];
  out.push(
    "<!-- Generated by scripts/scoreboard.ts from docs/generated/scoreboard.json. Do not edit. -->",
  );
  out.push("");
  out.push("# Scoreboard");
  out.push("");
  out.push(
    `ChadScript's promise is simple: a program either behaves exactly like Node, or ChadScript refuses to compile it and says why. This page measures that promise on a corpus of ${s.total} realistic TypeScript programs ([tests/corpus](${REPO}tests/corpus)): CLI tools, parsers, file-processing scripts, algorithms, class hierarchies, small interpreters and more, written the way people write TypeScript rather than for ChadScript.`,
  );
  out.push("");
  out.push(
    'Every program runs under Node and as a native binary (at -O0 and -O2), each in its own empty working directory. "Behaves exactly like Node" means the same standard output, the same standard error, the same exit code, and the same files left on disk, byte for byte.',
  );
  out.push("");
  out.push("| | Programs | Share |");
  out.push("| --- | ---: | ---: |");
  out.push(`| Programs that behave exactly like Node | ${s.match} | ${pct(s.match, s.total)} |`);
  out.push(
    `| Programs ChadScript refuses with a clear error | ${s.rejected} | ${pct(s.rejected, s.total)} |`,
  );
  out.push(
    `| Programs where ChadScript is wrong (0 is the goal) | ${s.divergent} | ${pct(s.divergent, s.total)} |`,
  );
  out.push(
    `| Programs where ChadScript crashes (0 is the goal) | ${s.crash} | ${pct(s.crash, s.total)} |`,
  );
  out.push(`| **Total** | **${s.total}** | |`);
  out.push("");
  out.push(
    "A refusal is the safe outcome: you get a `CS` error code pointing at the construct and a suggested rewrite, and nothing runs wrongly. Each program in the last two rows is a tracked bug, marked `@known-bug` in the corpus.",
  );
  out.push("");
  out.push("## By category");
  out.push("");
  out.push("| Category | Programs | Exactly like Node | Refused | Wrong | Crashes |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const c of s.categories) {
    out.push(
      `| ${c.name} | ${c.total} | ${c.match} | ${c.rejected} | ${c.divergent} | ${c.crash} |`,
    );
  }
  out.push("");
  out.push(`## Top ${TOP_REASONS} reasons for refusing a program`);
  out.push("");
  out.push(
    "These rank what to support next. A program refused for several reasons counts once under each. Codes link to their explanation on the [error codes](/reference/errors) page.",
  );
  out.push("");
  out.push("| # | Code | Reason | Programs | Examples |");
  out.push("| ---: | --- | --- | ---: | --- |");
  s.reasons.slice(0, TOP_REASONS).forEach((r, i) => {
    out.push(
      `| ${i + 1} | [${r.code}](/reference/errors#${r.code.toLowerCase()}) | ${cell(r.message)} | ${r.programs} | ${r.examples.map(programLink).join(", ")} |`,
    );
  });
  out.push("");
  const bugs = s.programs.filter((p) => p.outcome === "divergent" || p.outcome === "crash");
  out.push("## Known wrong or crashing programs");
  out.push("");
  if (bugs.length === 0) {
    out.push("None.");
  } else {
    out.push("| Program | Outcome | Bug |");
    out.push("| --- | --- | --- |");
    for (const b of bugs) {
      out.push(
        `| ${programLink(b.path)} | ${b.outcome === "crash" ? "crashes" : "wrong"} | ${cell(b.knownBug ?? b.detail)} |`,
      );
    }
  }
  out.push("");
  out.push("## Regenerating");
  out.push("");
  out.push(
    "`bun run scripts/scoreboard.ts` reruns the corpus and rewrites this page. The corpus test in the slow lane fails when a program without a `@known-bug` note diverges from Node or crashes the compiler, and when a `@known-bug` program starts working.",
  );
  out.push("");
  return out.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--render")) {
    const s = JSON.parse(readFileSync(JSON_PATH, "utf8")) as Scoreboard;
    writeFileSync(PAGE_PATH, renderScoreboardMarkdown(s));
    return;
  }
  const f = argv.indexOf("--filter");
  const filter = f >= 0 ? argv[f + 1] : undefined;
  const { corpusPrograms, runCorpus, corpusFailure } = await import("../tests/harness/corpus.js");
  const programs = corpusPrograms().filter((p) => filter === undefined || p.path.includes(filter));
  const results = await runCorpus(programs, (r) => {
    const why =
      r.outcome === "rejected"
        ? `${r.rejections[0]!.code} ${r.rejections[0]!.message.split("\n")[0]}`
        : r.detail;
    console.log(`${r.outcome.padEnd(9)} ${r.path}${why ? `  ${why}` : ""}`);
  });
  const s = buildScoreboard(results);
  console.log(
    `\nmatch ${s.match}  rejected ${s.rejected}  divergent ${s.divergent}  crash ${s.crash}  total ${s.total}`,
  );
  const failures = results.map(corpusFailure).filter((x): x is string => x !== null);
  for (const x of failures) console.log(`FAIL ${x}`);
  if (filter !== undefined) return;
  writeFileSync(JSON_PATH, `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(PAGE_PATH, renderScoreboardMarkdown(s));
}

// Run directly (not imported by the drift test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
