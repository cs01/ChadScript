import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURES = join(import.meta.dirname, "fixtures");

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

describe("chadscript v2 compiler", () => {
  it("hello world", () => {
    assert.equal(compileAndRun("hello.ts"), "hello world");
  });

  it("arithmetic", () => {
    const expected = nodeRun("arithmetic.ts");
    assert.equal(compileAndRun("arithmetic.ts"), expected);
  });

  it("fibonacci", () => {
    const expected = nodeRun("fib.ts");
    assert.equal(compileAndRun("fib.ts"), expected);
  });
});
