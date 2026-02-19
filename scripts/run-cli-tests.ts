#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests/autonomous');

interface CliTestCase {
  args: string[];
  exitCode: number;
  stdoutContains?: string;
  stderrContains?: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  expectedExitCode: number;
  stdoutMatch: boolean;
  stderrMatch: boolean;
  details?: string;
}

function compileCliProgram(): { success: boolean; binaryPath: string; error?: string } {
  const sourceFile = path.join(TESTS_DIR, 'cli-program.ts');
  const binaryPath = sourceFile.replace(/\.ts$/, '');

  console.log('Compiling CLI program...');
  console.log(`Source: ${sourceFile}`);
  console.log(`Output: ${binaryPath}`);

  try {
    execSync(`node dist/chad-node.js build ${sourceFile}`, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120000
    });

    if (fs.existsSync(binaryPath)) {
      console.log('Compilation succeeded');
      return { success: true, binaryPath };
    } else {
      return { success: false, binaryPath, error: 'Binary not created' };
    }
  } catch (error: any) {
    const stderr = error.stderr || error.message;
    console.error('Compilation failed:');
    console.error(stderr);
    return { success: false, binaryPath, error: stderr };
  }
}

function runTest(binaryPath: string, testCase: CliTestCase, index: number): TestResult {
  const name = `test-${index + 1}: ${JSON.stringify(testCase.args)}`;

  try {
    const argsString = testCase.args.map(a => `"${a}"`).join(' ');
    const result = execSync(`${binaryPath} ${argsString}`, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 10000
    });

    const stdoutMatch = !testCase.stdoutContains || result.includes(testCase.stdoutContains);
    const passed = testCase.exitCode === 0 && stdoutMatch;

    return {
      name,
      passed,
      stdout: result,
      stderr: '',
      exitCode: 0,
      expectedExitCode: testCase.exitCode,
      stdoutMatch,
      stderrMatch: true,
      details: passed ? undefined : `Expected exitCode=${testCase.exitCode}, stdoutContains="${testCase.stdoutContains}"`
    };
  } catch (error: any) {
    const exitCode = error.status ?? 1;
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';

    const exitCodeMatch = exitCode === testCase.exitCode;
    const stdoutMatch = !testCase.stdoutContains || stdout.includes(testCase.stdoutContains);
    const stderrMatch = !testCase.stderrContains || stderr.includes(testCase.stderrContains);
    const passed = exitCodeMatch && stdoutMatch && stderrMatch;

    return {
      name,
      passed,
      stdout,
      stderr,
      exitCode,
      expectedExitCode: testCase.exitCode,
      stdoutMatch,
      stderrMatch,
      details: passed ? undefined : [
        !exitCodeMatch ? `exitCode: got ${exitCode}, expected ${testCase.exitCode}` : null,
        !stdoutMatch ? `stdout missing: "${testCase.stdoutContains}"` : null,
        !stderrMatch ? `stderr missing: "${testCase.stderrContains}"` : null
      ].filter(Boolean).join(', ')
    };
  }
}

function runAllTests(): { results: TestResult[]; passCount: number; failCount: number } {
  const compile = compileCliProgram();

  if (!compile.success) {
    console.error('\nCompilation failed, cannot run tests');
    return {
      results: [{
        name: 'compilation',
        passed: false,
        stdout: '',
        stderr: compile.error || 'Unknown compilation error',
        exitCode: -1,
        expectedExitCode: 0,
        stdoutMatch: false,
        stderrMatch: false,
        details: compile.error
      }],
      passCount: 0,
      failCount: 1
    };
  }

  const testCasesPath = path.join(TESTS_DIR, 'cli-test-cases.json');
  if (!fs.existsSync(testCasesPath)) {
    console.error('Test cases file not found:', testCasesPath);
    return { results: [], passCount: 0, failCount: 0 };
  }

  const testCases: CliTestCase[] = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));
  const results: TestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  console.log(`\nRunning ${testCases.length} CLI tests...\n`);

  for (let i = 0; i < testCases.length; i++) {
    const result = runTest(compile.binaryPath, testCases[i], i);
    results.push(result);

    if (result.passed) {
      passCount++;
      console.log(`✓ ${result.name}`);
    } else {
      failCount++;
      console.log(`✗ ${result.name}`);
      console.log(`  Details: ${result.details}`);
      if (result.stdout) console.log(`  stdout: ${result.stdout.substring(0, 100)}`);
      if (result.stderr) console.log(`  stderr: ${result.stderr.substring(0, 100)}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passCount}/${testCases.length} passed`);
  console.log(`========================================\n`);

  return { results, passCount, failCount };
}

function generateReport(results: TestResult[]): void {
  const reportPath = path.join(PROJECT_ROOT, 'agent-state', 'cli-test-results.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results: results.map(r => ({
      name: r.name,
      passed: r.passed,
      exitCode: r.exitCode,
      expectedExitCode: r.expectedExitCode,
      details: r.details
    }))
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${reportPath}`);
}

const { results } = runAllTests();
generateReport(results);

const failedTests = results.filter(r => !r.passed).length;
process.exit(failedTests > 0 ? 1 : 0);
