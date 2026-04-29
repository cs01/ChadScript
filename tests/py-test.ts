import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "child_process";
import { readdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures-py");
const CLI = join(ROOT, "src", "cli-py.ts");

function runPython(file: string): string {
  const result = spawnSync("python3", [file], { encoding: "utf-8", timeout: 10000 });
  if (result.status !== 0) throw new Error(`python3 failed: ${result.stderr}`);
  return result.stdout;
}

function compileMilo(file: string, outDir: string): string {
  const name = basename(file, ".py");
  const out = join(outDir, name);
  execSync(`npx tsx ${CLI} build ${file} -o ${out}`, {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 60000,
  });
  return out;
}

function runBinary(bin: string): string {
  const result = spawnSync(bin, [], { encoding: "utf-8", timeout: 10000 });
  if (result.status !== 0) throw new Error(`binary exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".py"))
  .sort();

const outDir = mkdtempSync(join(tmpdir(), "milo-test-"));

describe("milo python fixtures", () => {
  for (const file of fixtures) {
    const name = basename(file, ".py");
    test(name, async () => {
      const path = join(FIXTURES, file);
      const expected = runPython(path);
      const bin = compileMilo(path, outDir);
      const actual = runBinary(bin);
      assert.equal(actual, expected, `stdout mismatch for ${name}`);
    });
  }
});
