#!/usr/bin/env npx tsx
/**
 * ChadScript Progress Checker
 *
 * Run this after each fix to see current status.
 * Usage: npm run check-progress
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(PROJECT_ROOT, "agent-state");
const TESTS_DIR = path.join(PROJECT_ROOT, "tests/autonomous");

interface Progress {
  timestamp: string;
  cliCompiles: boolean;
  cliTestsPassed: number;
  cliTestsTotal: number;
  existingTestsPass: boolean;
  lastError?: string;
  status: "all-passing" | "cli-failing" | "existing-tests-failing" | "compile-failing";
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function printHeader(text: string): void {
  console.log("\n" + "═".repeat(60));
  console.log(`  ${text}`);
  console.log("═".repeat(60));
}

function printSection(emoji: string, text: string): void {
  console.log(`\n${emoji} ${text}`);
  console.log("─".repeat(40));
}

function compileCliProgram(): { success: boolean; error?: string } {
  const sourceFile = path.join(TESTS_DIR, "cli-program.ts");

  if (!fs.existsSync(sourceFile)) {
    return { success: false, error: "cli-program.ts not found" };
  }

  try {
    execSync(`node dist/chad-node.js build ${sourceFile}`, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 120000,
    });
    return { success: true };
  } catch (error: any) {
    // Extract the actual error, filtering out DEBUG spam
    let stderr = error.stderr || error.message || "Unknown error";
    const lines = stderr.split("\n");
    const errorLines = lines.filter(
      (l: string) =>
        l.includes("error:") || l.includes("Error:") || (l.trim() && !l.startsWith("DEBUG")),
    );
    const cleanError = errorLines.slice(0, 10).join("\n") || stderr.substring(0, 500);
    return { success: false, error: cleanError };
  }
}

interface CliTestCase {
  args: string[];
  exitCode: number;
  stdoutContains?: string;
  stderrContains?: string;
}

function runCliTests(): { passed: number; total: number; failures: string[] } {
  const binaryPath = path.join(PROJECT_ROOT, ".build/tests/autonomous/cli-program");
  const testCasesPath = path.join(TESTS_DIR, "cli-test-cases.json");

  if (!fs.existsSync(binaryPath)) {
    return { passed: 0, total: 0, failures: ["Binary not found"] };
  }

  if (!fs.existsSync(testCasesPath)) {
    return { passed: 0, total: 0, failures: ["Test cases file not found"] };
  }

  const testCases: CliTestCase[] = JSON.parse(fs.readFileSync(testCasesPath, "utf8"));
  let passed = 0;
  const failures: string[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const testName = `Test ${i + 1}: ${JSON.stringify(tc.args)}`;

    try {
      const result = execSync(`${binaryPath} ${tc.args.join(" ")}`, {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });

      const stdoutOk = !tc.stdoutContains || result.includes(tc.stdoutContains);
      if (tc.exitCode === 0 && stdoutOk) {
        passed++;
      } else {
        failures.push(`${testName}: Expected exit 0, stdout to contain "${tc.stdoutContains}"`);
      }
    } catch (error: any) {
      const exitCode = error.status ?? 1;
      const stdout = error.stdout || "";
      const stderr = error.stderr || "";

      const exitOk = exitCode === tc.exitCode;
      const stdoutOk = !tc.stdoutContains || stdout.includes(tc.stdoutContains);
      const stderrOk = !tc.stderrContains || stderr.includes(tc.stderrContains);

      if (exitOk && stdoutOk && stderrOk) {
        passed++;
      } else {
        let reason = "";
        if (!exitOk) reason += `exit=${exitCode} (expected ${tc.exitCode}) `;
        if (!stdoutOk) reason += `stdout missing "${tc.stdoutContains}" `;
        if (!stderrOk) reason += `stderr missing "${tc.stderrContains}" `;
        failures.push(`${testName}: ${reason}`);
      }
    }
  }

  return { passed, total: testCases.length, failures };
}

function runExistingTests(): boolean {
  try {
    execSync("npm test", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 300000,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function saveProgress(progress: Progress): void {
  ensureDir(STATE_DIR);
  fs.writeFileSync(path.join(STATE_DIR, "progress.json"), JSON.stringify(progress, null, 2));
}

function main(): void {
  printHeader("ChadScript Progress Check");

  const progress: Progress = {
    timestamp: new Date().toISOString(),
    cliCompiles: false,
    cliTestsPassed: 0,
    cliTestsTotal: 0,
    existingTestsPass: false,
    status: "compile-failing",
  };

  // Step 1: Compile CLI program
  printSection("🔨", "COMPILING CLI PROGRAM");
  const compile = compileCliProgram();

  if (!compile.success) {
    console.log("❌ COMPILATION FAILED\n");
    console.log(compile.error);
    progress.lastError = compile.error;
    progress.status = "compile-failing";

    // Save error for reference
    ensureDir(STATE_DIR);
    fs.writeFileSync(path.join(STATE_DIR, "current-error.txt"), compile.error || "Unknown");

    saveProgress(progress);

    printHeader("❌ FIX THE COMPILATION ERROR ABOVE");
    console.log("\nThe LLVM IR has a type mismatch. Check src/codegen/ for the bug.\n");
    process.exit(1);
  }

  console.log("✅ Compilation successful!");
  progress.cliCompiles = true;

  // Step 2: Run CLI tests
  printSection("🧪", "RUNNING CLI TESTS");
  const cliResults = runCliTests();
  progress.cliTestsPassed = cliResults.passed;
  progress.cliTestsTotal = cliResults.total;

  console.log(`Result: ${cliResults.passed}/${cliResults.total} passed`);

  if (cliResults.failures.length > 0) {
    console.log("\nFailures:");
    cliResults.failures.slice(0, 5).forEach((f) => console.log(`  ❌ ${f}`));
    if (cliResults.failures.length > 5) {
      console.log(`  ... and ${cliResults.failures.length - 5} more`);
    }
    progress.lastError = cliResults.failures[0];
    progress.status = "cli-failing";
  }

  // Step 3: Run existing tests (only if CLI tests pass)
  if (cliResults.passed === cliResults.total && cliResults.total > 0) {
    printSection("📋", "RUNNING EXISTING TESTS");
    progress.existingTestsPass = runExistingTests();

    if (progress.existingTestsPass) {
      console.log("✅ All existing tests pass!");
      progress.status = "all-passing";
    } else {
      console.log("❌ Some existing tests failed");
      console.log("Run `npm test` to see details");
      progress.status = "existing-tests-failing";
    }
  } else {
    console.log("\n⏭️  Skipping existing tests (fix CLI tests first)");
  }

  // Save progress
  saveProgress(progress);

  // Final summary
  printHeader(progress.status === "all-passing" ? "✅ ALL TESTS PASSING!" : "🔧 KEEP FIXING...");

  console.log(`
  CLI Compiles:     ${progress.cliCompiles ? "✅" : "❌"}
  CLI Tests:        ${progress.cliTestsPassed}/${progress.cliTestsTotal} ${progress.cliTestsPassed === progress.cliTestsTotal && progress.cliTestsTotal > 0 ? "✅" : "❌"}
  Existing Tests:   ${progress.existingTestsPass ? "✅" : "⏸️"}
  `);

  if (progress.status === "all-passing") {
    console.log("🎉 Great job! All tests are passing!\n");
    process.exit(0);
  } else {
    console.log("Next step: Fix the error shown above, then run this again.\n");
    process.exit(1);
  }
}

main();
