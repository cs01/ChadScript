import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURES = join(import.meta.dirname, "fixtures");
const ERROR_FIXTURES = join(FIXTURES, "errors");

function compileAndRun(fixture: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "chad2-test-"));
  const outBin = join(tmpDir, "out");

  try {
    execSync(`npx tsx src/cli.ts build ${join(FIXTURES, fixture)} -o ${outBin}`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    const result = execSync(outBin, { encoding: "utf-8", timeout: 10000 });
    return result.trimEnd();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function nodeRun(fixture: string): string {
  const result = execSync(`node --experimental-strip-types ${join(FIXTURES, fixture)}`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  return result.trimEnd();
}

const PARITY_FIXTURES = [
  "hello.ts",
  "arithmetic.ts",
  "fib.ts",
  "while-loop.ts",
  "for-loop.ts",
  "boolean-logic.ts",
  "nested-calls.ts",
  "if-else.ts",
  "integer-narrowing.ts",
  "increment.ts",
  "string-basic.ts",
  "multi-function.ts",
  "bitwise.ts",
  "modulo.ts",
  "division.ts",
  "math-functions.ts",
  "nested-if.ts",
  "logical-ops.ts",
  "break-continue.ts",
  "multi-arg-log.ts",
  "prime-sieve.ts",
  "monte-carlo.ts",
];

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

describe("chadscript v2 compiler", () => {
  for (const fixture of PARITY_FIXTURES) {
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
    assert.match(err, /unsupported expression type: ArrayExpression/);
  });
});
