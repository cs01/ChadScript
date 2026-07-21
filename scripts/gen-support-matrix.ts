// Support-matrix generator (salvage plan PR 0.1 / "publish the support contract").
//
// Classifies every discovered fixture into one of three buckets from the recorded dual-host
// baseline, so the project can state — in machine-readable form — exactly what it supports:
//
//   supported             both hosts compile it AND it runs to the expected outcome
//   rejected-with-diagnostic  both hosts reject it with a clean compile-error diagnostic
//   unknown               anything else: host divergence, unexpected failure, or a compile
//                         anomaly/crash. NOT promoted to "supported" — these are the honest
//                         gaps in the contract.
//
// Writes tests/support-matrix.json (the machine-readable contract) and refreshes the
// generated summary block in docs/language/supported-subset.md.
//
// Regenerate:  npm run support-matrix   (after `npm run baseline`)

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, TestCase } from "../tests/test-discovery";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

type Status = "supported" | "rejected-with-diagnostic" | "unknown";

interface FixtureRow {
  fixture: string;
  category: string;
  kind: string;
  status: Status;
  reason: string;
}

// The subset of the baseline shape this tool relies on (summarized form).
interface BaselineHost {
  compile?: { status: string };
  run?: { exitCode: number | null; containsTestPassed: boolean };
  skipped?: string;
}
interface BaselineFixture {
  fixture: string;
  kind: string;
  hosts: Record<string, BaselineHost>;
}

function category(fixture: string): string {
  const m = fixture.match(/tests\/fixtures\/([^/]+)\//);
  return m ? m[1] : "(root)";
}

// Non-skipped hosts present in the baseline for a fixture (node is skipped for native-only).
function activeHosts(bf: BaselineFixture): [string, BaselineHost][] {
  return Object.entries(bf.hosts).filter(([, h]) => !h.skipped);
}

function classify(
  tc: TestCase,
  bf: BaselineFixture | undefined,
): { status: Status; reason: string } {
  if (!bf) return { status: "unknown", reason: "no baseline entry" };
  const hosts = activeHosts(bf);
  if (hosts.length === 0) return { status: "unknown", reason: "all hosts skipped" };

  if (bf.kind === "compile-error") {
    const allReject = hosts.every(([, h]) => h.compile?.status === "compile-error");
    return allReject
      ? { status: "rejected-with-diagnostic", reason: "" }
      : {
          status: "unknown",
          reason:
            "expected a clean compile-error on all hosts, got: " +
            hosts.map(([l, h]) => `${l}=${h.compile?.status}`).join(", "),
        };
  }

  // Run / exit-code fixtures: must compile ok on every active host first.
  const badCompile = hosts.filter(([, h]) => h.compile?.status !== "ok");
  if (badCompile.length > 0) {
    return {
      status: "unknown",
      reason:
        "does not compile cleanly: " +
        badCompile.map(([l, h]) => `${l}=${h.compile?.status}`).join(", "),
    };
  }

  // ...and produce the expected runtime outcome on every active host.
  if (bf.kind === "exit-code") {
    const expected = tc.expectedExitCode;
    const mismatched = hosts.filter(([, h]) => h.run?.exitCode !== expected);
    return mismatched.length === 0
      ? { status: "supported", reason: "" }
      : {
          status: "unknown",
          reason:
            `expected exit ${expected}, got: ` +
            mismatched.map(([l, h]) => `${l}=${h.run?.exitCode}`).join(", "),
        };
  }

  // Plain run fixture: convention is stdout contains TEST_PASSED and exit 0.
  const failed = hosts.filter(([, h]) => !h.run?.containsTestPassed || h.run?.exitCode !== 0);
  return failed.length === 0
    ? { status: "supported", reason: "" }
    : {
        status: "unknown",
        reason:
          "did not pass on: " +
          failed
            .map(([l, h]) => `${l}=exit${h.run?.exitCode}/pass=${h.run?.containsTestPassed}`)
            .join(", "),
      };
}

function main() {
  const baselinePath = process.argv[2] || "tests/baseline/compiler-baseline.json";
  const abs = path.resolve(projectRoot, baselinePath);
  if (!fs.existsSync(abs)) {
    console.error(`baseline not found at ${baselinePath}. Run: npm run baseline`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(abs, "utf8"));
  const byFixture = new Map<string, BaselineFixture>();
  for (const r of baseline.results) byFixture.set(r.fixture, r);

  const cases = discoverTests()
    .slice()
    .sort((a, b) => a.fixture.localeCompare(b.fixture));

  const rows: FixtureRow[] = cases.map((tc) => {
    const { status, reason } = classify(tc, byFixture.get(tc.fixture));
    return {
      fixture: tc.fixture,
      category: category(tc.fixture),
      kind: fixtureKindOf(tc),
      status,
      reason,
    };
  });

  // Summaries.
  const byStatus: Record<Status, number> = {
    supported: 0,
    "rejected-with-diagnostic": 0,
    unknown: 0,
  };
  const byCategory: Record<string, Record<Status, number>> = {};
  for (const r of rows) {
    byStatus[r.status]++;
    (byCategory[r.category] ??= { supported: 0, "rejected-with-diagnostic": 0, unknown: 0 })[
      r.status
    ]++;
  }

  const matrix = {
    meta: {
      note: "Generated by scripts/gen-support-matrix.ts from the dual-host baseline. Do not hand-edit.",
      baselineGitSha: baseline.meta?.gitSha ?? "unknown",
      platform: baseline.meta?.platform ?? "unknown",
      fixtureCount: rows.length,
      byStatus,
    },
    fixtures: rows,
  };
  const outJson = path.resolve(projectRoot, "tests/support-matrix.json");
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(matrix, null, 2) + "\n");

  updateDoc(byStatus, byCategory, rows);

  console.log(`support-matrix: ${rows.length} fixtures → tests/support-matrix.json`);
  console.log(
    `  supported: ${byStatus.supported}, rejected: ${byStatus["rejected-with-diagnostic"]}, unknown: ${byStatus.unknown}`,
  );
}

function fixtureKindOf(tc: TestCase): string {
  if (tc.compileError) return "compile-error";
  if (tc.expectedExitCode !== undefined) return "exit-code";
  return "run";
}

const DOC_PATH = "docs/language/supported-subset.md";
const GEN_START = "<!-- GENERATED:support-matrix START -->";
const GEN_END = "<!-- GENERATED:support-matrix END -->";

function updateDoc(
  byStatus: Record<Status, number>,
  byCategory: Record<string, Record<Status, number>>,
  rows: FixtureRow[],
): void {
  const lines: string[] = [];
  lines.push(GEN_START);
  lines.push("");
  lines.push(`_Generated from the dual-host baseline over ${rows.length} fixtures._`);
  lines.push("");
  lines.push(
    `| Status | Count |`,
    `| --- | ---: |`,
    `| supported | ${byStatus.supported} |`,
    `| rejected-with-diagnostic | ${byStatus["rejected-with-diagnostic"]} |`,
    `| unknown | ${byStatus.unknown} |`,
  );
  lines.push("");
  lines.push(`### By category`);
  lines.push("");
  lines.push(`| Category | supported | rejected | unknown |`, `| --- | ---: | ---: | ---: |`);
  for (const cat of Object.keys(byCategory).sort()) {
    const c = byCategory[cat];
    lines.push(`| ${cat} | ${c.supported} | ${c["rejected-with-diagnostic"]} | ${c.unknown} |`);
  }
  lines.push("");
  const unknowns = rows.filter((r) => r.status === "unknown");
  lines.push(`### Unknown (${unknowns.length}) — the honest gaps`);
  lines.push("");
  if (unknowns.length === 0) {
    lines.push(`_None._`);
  } else {
    for (const u of unknowns) lines.push(`- \`${u.fixture}\` — ${u.reason}`);
  }
  lines.push("");
  lines.push(GEN_END);
  const generated = lines.join("\n");

  const docAbs = path.resolve(projectRoot, DOC_PATH);
  let doc = fs.existsSync(docAbs) ? fs.readFileSync(docAbs, "utf8") : docTemplate();
  if (doc.includes(GEN_START) && doc.includes(GEN_END)) {
    doc = doc.replace(new RegExp(`${GEN_START}[\\s\\S]*${GEN_END}`), generated);
  } else {
    doc = doc.trimEnd() + "\n\n" + generated + "\n";
  }
  fs.mkdirSync(path.dirname(docAbs), { recursive: true });
  fs.writeFileSync(docAbs, doc);
}

function docTemplate(): string {
  return `# Supported language subset

ChadScript compiles a **subset** of TypeScript to native code. It does **not** claim general
TypeScript compatibility. This page is the support contract: what the compiler is expected to
accept, what it is expected to reject with a diagnostic, and what is currently unclassified.

The contract is derived mechanically from the dual-host baseline (the node-hosted and
native-hosted compilers must agree). The machine-readable form lives in
[\`tests/support-matrix.json\`](../../tests/support-matrix.json).

## Categories

- **supported** — both hosts compile the fixture and it runs to its expected outcome.
- **rejected-with-diagnostic** — both hosts reject the program with a clean compile-error
  diagnostic (no crash, no arbitrary exit — see the negative-fixture contract).
- **unknown** — everything else: the two hosts disagree, the program fails unexpectedly, or
  compilation ends in an anomaly. An \`unknown\` is never promoted to \`supported\` just because
  one host happens to pass; these are the gaps to close.

## Regenerating

\`\`\`bash
npm run baseline          # record the dual-host baseline
npm run support-matrix    # regenerate the matrix + the block below
\`\`\`

`;
}

main();
