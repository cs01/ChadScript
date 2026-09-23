// Every code sample on the documentation site is a file under docs/examples/, embedded into the
// page with VitePress's `<<< @/examples/...` import. This suite compiles and runs each one against
// Node (O0 + O2), so a sample on the site can never show a program the compiler rejects or
// miscompiles. tests/unit/docs-site.test.ts checks the pages reference only these files.
//
// `// @native-only: <why>` marks a sample that shows a DELIBERATE divergence (JSON.parse's shape
// check). It has no Node oracle, so its native stdout is pinned in a sibling `<name>.out`, and
// Node must still disagree: if Node ever matches, the sample belongs in the differential set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative } from "node:path";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { discoverFixtures } from "../harness/discover.js";
import { differential, run, runOracle } from "../harness/differential.js";
import { loadProgram } from "../../src/frontend/program.js";
import { validate } from "../../src/validate/validate.js";
import { emitIr, linkIr, runtimeObjects } from "../../src/driver/build.js";
import { check } from "../../src/pipeline.js";
import { renderDiagnostic } from "../../src/diagnostics.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examplesRoot = join(repo, "docs", "examples");
const only = process.env["CHAD_FIXTURE"];

async function nativeOnly(path: string): Promise<string[]> {
  const expected = readFileSync(path.replace(/\.ts$/, ".out"), "utf8");
  const loaded = loadProgram(path);
  validate(loaded);
  const dir = mkdtempSync(join(tmpdir(), "chad-docs-"));
  writeFileSync(join(dir, "out.ll"), emitIr(loaded));
  await linkIr(join(dir, "out.ll"), join(dir, "bin"), "2", runtimeObjects());
  const [native, node] = await Promise.all([run(join(dir, "bin"), []), runOracle(path)]);
  const problems: string[] = [];
  if (native.stdout !== expected || native.exit !== 0) {
    problems.push(`native stdout ${JSON.stringify(native.stdout)} (exit ${native.exit}) != .out`);
  }
  if (node.stdout === native.stdout) {
    problems.push("Node now agrees; drop @native-only and the .out file");
  }
  return problems;
}

// The page shows `<name>.out` as the program's output. Node is the oracle and the differential
// check already ties the native binary to Node, so the shown output only has to equal Node's.
async function shownOutput(path: string, args: string[]): Promise<string[]> {
  const outPath = path.replace(/\.ts$/, ".out");
  if (!existsSync(outPath)) return [];
  const node = await runOracle(path, args);
  return node.stdout === readFileSync(outPath, "utf8")
    ? []
    : [`${relative(repo, outPath)} is stale: Node prints ${JSON.stringify(node.stdout)}`];
}

// A `// @expect-reject: CSxxxx` sample shows a rejection. Its `<name>.err` holds the command and
// the diagnostics exactly as `bin/chad check <name>.ts` prints them from the sample's directory.
function rejected(path: string, code: string): string[] {
  const result = check(path);
  if (result.accepted) return [`expected ${code}, but the program was accepted`];
  const rendered = result.diagnostics
    .map((d) =>
      renderDiagnostic(d.span ? { ...d, span: { ...d.span, file: basename(d.span.file) } } : d),
    )
    .join("\n");
  const expected = readFileSync(path.replace(/\.ts$/, ".err"), "utf8");
  const want = `$ bin/chad check ${basename(path)}\n${rendered}\n`;
  const problems: string[] = [];
  if (!result.diagnostics.some((d) => d.code === code)) problems.push(`no ${code} diagnostic`);
  if (expected !== want) problems.push(`.err is stale; the compiler prints:\n${want}`);
  return problems;
}

test("docs examples match Node (O0 + O2)", { timeout: 300_000 }, async () => {
  const fixtures = discoverFixtures(examplesRoot).filter(
    (fx) => only === undefined || fx.path.includes(only),
  );
  assert.ok(fixtures.length > 0, `no docs examples matched${only ? ` CHAD_FIXTURE=${only}` : ""}`);
  const failures: string[] = [];
  await Promise.all(
    fixtures.map(async (fx) => {
      const name = relative(repo, fx.path);
      const head = readFileSync(fx.path, "utf8").split("\n", 1)[0]!;
      try {
        const problems = fx.expectReject
          ? rejected(fx.path, fx.expectReject)
          : head.includes("@native-only:")
            ? await nativeOnly(fx.path)
            : [
                ...(await differential(fx.path, fx.args)).map((d) => `[${d.kind}] ${d.detail}`),
                ...(await shownOutput(fx.path, fx.args)),
              ];
        if (problems.length > 0) failures.push(`${name}:\n    ${problems.join("\n    ")}`);
      } catch (e) {
        failures.push(`${name}: [compile] ${(e as Error).message}`);
      }
    }),
  );
  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});
