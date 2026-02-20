import { describe, it } from "node:test";
import assert from "node:assert";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

const execAsync = promisify(exec);

const compiler = fsSync.existsSync(".build/chad")
  ? ".build/chad build"
  : "node dist/chad-node.js build";

interface TestCase {
  name: string;
  fixture: string;
  description: string;
  expectedExitCode?: number;
  expectTestPassed?: boolean;
  args?: string[];
}

const smokeTests: TestCase[] = [
  {
    name: "arithmetic",
    fixture: "tests/fixtures/arithmetic/simple-add.js",
    expectedExitCode: 12,
    description: "Arithmetic: add(5, 7) should return 12",
  },
  {
    name: "string-methods",
    fixture: "tests/fixtures/strings/string-split-length.ts",
    expectTestPassed: true,
    description: "Strings: split() and length should work",
  },
  {
    name: "string-trim",
    fixture: "tests/fixtures/strings/string-trim-simple.ts",
    expectTestPassed: true,
    description: "Strings: trim() should remove whitespace",
  },
  {
    name: "if-else",
    fixture: "tests/fixtures/control-flow/if-else.js",
    expectedExitCode: 15,
    description: "Control flow: if-else should branch correctly",
  },
  {
    name: "for-loop",
    fixture: "tests/fixtures/control-flow/for-loop.js",
    expectedExitCode: 55,
    description: "Control flow: for loop should sum 1-10",
  },
  {
    name: "while-loop",
    fixture: "tests/fixtures/control-flow/while-loop.js",
    expectedExitCode: 15,
    description: "Control flow: while loop should sum 5-1",
  },
  {
    name: "array-literal",
    fixture: "tests/fixtures/arrays/array-literal.js",
    expectedExitCode: 3,
    description: "Arrays: literal and .length should work",
  },
  {
    name: "array-push",
    fixture: "tests/fixtures/arrays/array-push.js",
    expectedExitCode: 4,
    description: "Arrays: push() should add element",
  },
  {
    name: "array-filter",
    fixture: "tests/fixtures/arrays/array-filter.js",
    expectedExitCode: 3,
    description: "Arrays: filter() with callback should work",
  },
  {
    name: "array-slice",
    fixture: "tests/fixtures/arrays/array-slice.ts",
    expectTestPassed: true,
    description: "Arrays: slice() should return sub-array",
  },
  {
    name: "array-init-safe",
    fixture: "tests/fixtures/arrays/array-init-safe.ts",
    expectedExitCode: 10,
    description: "Arrays: zero-initialized with calloc for safe iteration",
  },
  {
    name: "object-literal",
    fixture: "tests/fixtures/objects/object-literal.js",
    expectedExitCode: 30,
    description: "Objects: literal and property access",
  },
  {
    name: "class-basic",
    fixture: "tests/fixtures/classes/class-basic.js",
    expectedExitCode: 10,
    description: "Classes: constructor, methods, and this",
  },
  {
    name: "console-log",
    fixture: "tests/fixtures/builtins/console-log.js",
    expectTestPassed: true,
    description: "Builtins: console.log and console.error",
  },
  {
    name: "fs-readFileSync",
    fixture: "tests/fixtures/builtins/fs-readfile-test.ts",
    expectTestPassed: true,
    description: "Builtins: fs.readFileSync should read files",
  },
  {
    name: "imports-exports",
    fixture: "tests/fixtures/imports-exports/imports-main.js",
    expectedExitCode: 19,
    description: "Imports: multi-file compilation",
  },
  {
    name: "logical-operators",
    fixture: "tests/fixtures/logical/logical-operators.js",
    expectedExitCode: 5,
    description: "Logical: || and && should work",
  },
];

describe("Smoke Tests", { concurrency: 8 }, () => {
  for (const testCase of smokeTests) {
    it(testCase.description, async () => {
      const fixturePath = testCase.fixture;
      const fixtureDir = path.dirname(testCase.fixture);
      const outputDir = path.join(".build", fixtureDir);
      const extension = path.extname(fixturePath);
      const baseName = path.basename(fixturePath, extension);
      const llFile = path.join(outputDir, `${baseName}.ll`);
      const exeFile = path.join(outputDir, baseName);

      try {
        if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
        if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
      } catch (err) {}

      try {
        await execAsync(`${compiler} ${fixturePath}`);

        // Verify executable was generated (intermediate files are cleaned up by default)
        assert.ok(fsSync.existsSync(exeFile), `Executable should exist at ${exeFile}`);

        const args = testCase.args ? testCase.args.join(" ") : "";
        const command = args ? `${exeFile} ${args}` : exeFile;

        let result;
        let actualExitCode = 0;

        try {
          result = await execAsync(command);
          actualExitCode = 0;
        } catch (err: any) {
          actualExitCode = err.code || err.status || 1;
          result = err;
        }

        if (testCase.expectTestPassed) {
          const stdout = result.stdout || "";
          if (!stdout.includes("TEST_PASSED")) {
            throw new Error(
              `Test did not print TEST_PASSED. stdout: ${stdout}. stderr: ${result.stderr || ""}`,
            );
          }
          assert.strictEqual(actualExitCode, 0);
        } else if (testCase.expectedExitCode !== undefined) {
          assert.strictEqual(
            actualExitCode,
            testCase.expectedExitCode,
            `Expected exit code ${testCase.expectedExitCode}, got ${actualExitCode}`,
          );
        }
      } finally {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {}
      }
    });
  }
});
