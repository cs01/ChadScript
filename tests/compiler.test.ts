import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURES = join(import.meta.dirname, "fixtures");
const ERROR_FIXTURES = join(FIXTURES, "errors");

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

function discoverFixtures(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "errors") continue;
    if (statSync(full).isDirectory()) {
      for (const f of readdirSync(full)) {
        if (f.endsWith(".ts")) results.push(join(entry, f));
      }
    }
  }
  return results.sort();
}

function compileAndRun(fixture: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "chad2-test-"));
  const outBin = join(tmpDir, "out");

  try {
    execSync(`npx tsx src/cli.ts build ${join(FIXTURES, fixture)} -o ${outBin}`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    const result = execSync(outBin, { encoding: "utf-8", timeout: 10000 });
    return stripAnsi(result.trimEnd());
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function nodeRun(fixture: string): string {
  const result = execSync(`node --experimental-transform-types ${join(FIXTURES, fixture)}`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  return stripAnsi(result.trimEnd());
}

const fixtures = discoverFixtures(FIXTURES);

function compileExpectError(fixture: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "chad2-test-"));
  const outBin = join(tmpDir, "out");

  try {
    execSync(`npx tsx src/cli.ts build ${join(ERROR_FIXTURES, fixture)} -o ${outBin}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    throw new Error(`expected compile error for ${fixture}`);
  } catch (e: any) {
    if (e.stderr) return e.stderr.trimEnd();
    if (e.message?.includes("expected compile error")) throw e;
    return "";
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("chadscript v2 compiler", { concurrency: 8 }, () => {
  for (const fixture of fixtures) {
    const name = fixture.replace(".ts", "");
    it(name, () => {
      const expected = nodeRun(fixture);
      assert.equal(compileAndRun(fixture), expected);
    });
  }
});

describe("compile errors", () => {
  it("undeclared function", () => {
    const err = compileExpectError("undeclared-fn.ts");
    assert.match(err, /call to undeclared function 'foo'/);
    assert.match(err, /1:2/);
  });

  it("unsupported expression", () => {
    const err = compileExpectError("unsupported-expr.ts");
    assert.match(err, /unsupported expression type: ClassExpression/);
  });
});
