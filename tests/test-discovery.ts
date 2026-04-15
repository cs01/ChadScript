// Auto-discovers test fixtures from tests/fixtures/ using @test annotations.
// Replaces the manually-maintained test-fixtures.ts registry.
//
// Annotation format (in the first 10 lines of each fixture file):
//   // @test-exit-code: 12       — assert process exits with code 12
//   // @test-compile-error: msg  — assert compilation fails with error containing "msg"
//   // @test-args: hello world   — pass CLI args to the compiled binary
//   // @test-description: ...    — custom test description
//   // @test-native-only         — skip when running with node compiler
//   // @test-skip                — exclude from auto-discovery
//   // @test-requires-env: VAR   — skip unless process.env.VAR is set and non-empty
//
// Defaults (no annotation needed):
//   expectTestPassed: true — asserts stdout contains TEST_PASSED and exit code 0
//   Description auto-generated from filename: "string-split-length.ts" → "string split length"

import * as fs from "node:fs";
import * as path from "node:path";

export interface TestCase {
  name: string;
  fixture: string;
  description: string;
  expectedExitCode?: number;
  expectTestPassed?: boolean;
  compileError?: string;
  args?: string[];
  nativeOnly?: boolean;
}

interface ParsedAnnotations {
  exitCode?: number;
  compileError?: string;
  args?: string[];
  description?: string;
  skip: boolean;
  nativeOnly: boolean;
  requiresEnv?: string;
}

function parseAnnotations(filePath: string): ParsedAnnotations {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").slice(0, 10);

  const result: ParsedAnnotations = { skip: false, nativeOnly: false };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "// @test-skip") {
      result.skip = true;
    }

    if (trimmed === "// @test-native-only") {
      result.nativeOnly = true;
    }

    const exitCodeMatch = trimmed.match(/^\/\/\s*@test-exit-code:\s*(\d+)/);
    if (exitCodeMatch) {
      result.exitCode = parseInt(exitCodeMatch[1], 10);
    }

    const argsMatch = trimmed.match(/^\/\/\s*@test-args:\s*(.+)/);
    if (argsMatch) {
      result.args = argsMatch[1].trim().split(/\s+/);
    }

    const compileErrorMatch = trimmed.match(/^\/\/\s*@test-compile-error:\s*(.+)/);
    if (compileErrorMatch) {
      result.compileError = compileErrorMatch[1].trim();
    }

    const descMatch = trimmed.match(/^\/\/\s*@test-description:\s*(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }

    const requiresEnvMatch = trimmed.match(/^\/\/\s*@test-requires-env:\s*(\S+)/);
    if (requiresEnvMatch) {
      result.requiresEnv = requiresEnvMatch[1].trim();
    }
  }

  return result;
}

// "string-split-length.ts" → "string split length"
function filenameToDescription(filename: string): string {
  const base = path.basename(filename).replace(/\.(tsx?|js)$/, "");
  return base.replace(/[-_]/g, " ");
}

function collectFixtures(dir: string, base: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFixtures(fullPath, base));
    } else if (/\.(js|tsx?|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      results.push(path.relative(base, fullPath));
    }
  }

  return results;
}

export function discoverTests(fixturesDir: string = "tests/fixtures"): TestCase[] {
  const projectRoot = path.resolve(fixturesDir, "../..");
  const absFixturesDir = path.resolve(fixturesDir);
  const relativePaths = collectFixtures(absFixturesDir, projectRoot);

  const tests: TestCase[] = [];

  for (const relPath of relativePaths) {
    const absPath = path.resolve(projectRoot, relPath);
    const annotations = parseAnnotations(absPath);

    if (annotations.skip) continue;
    if (annotations.requiresEnv) {
      const val = process.env[annotations.requiresEnv];
      if (!val || val.length === 0) continue;
    }

    // Name from relative path without extension: "arrays/array-filter"
    const relToFixtures = path.relative(fixturesDir, relPath);
    const name = relToFixtures.replace(/\.(tsx?|js)$/, "");

    const description = annotations.description || filenameToDescription(relPath);

    const testCase: TestCase = { name, fixture: relPath, description };

    if (annotations.compileError) {
      testCase.compileError = annotations.compileError;
    } else if (annotations.exitCode !== undefined) {
      testCase.expectedExitCode = annotations.exitCode;
    } else {
      testCase.expectTestPassed = true;
    }

    if (annotations.args) {
      testCase.args = annotations.args;
    }

    if (annotations.nativeOnly) {
      testCase.nativeOnly = true;
    }

    tests.push(testCase);
  }

  // Sort by fixture path for deterministic order
  tests.sort((a, b) => a.fixture.localeCompare(b.fixture));

  return tests;
}
