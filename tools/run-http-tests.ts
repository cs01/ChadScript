#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests/autonomous');

interface HttpTestCase {
  method: string;
  path: string;
  body?: string;
  expectStatus?: number;
  expectBody?: string;
  expectHeader?: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  expressResponse?: HttpResponse;
  chadscriptResponse?: HttpResponse;
  details?: string;
}

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const HTTP_TEST_CASES: HttpTestCase[] = [
  { method: 'GET', path: '/', expectBody: 'Hello' },
  { method: 'GET', path: '/echo?msg=test', expectBody: 'test' },
  { method: 'GET', path: '/json', expectHeader: 'application/json' },
  { method: 'POST', path: '/echo', body: 'hello', expectBody: 'hello' },
  { method: 'GET', path: '/status/404', expectStatus: 404 }
];

function compileHttpProgram(): { success: boolean; binaryPath: string; error?: string } {
  const sourceFile = path.join(TESTS_DIR, 'http-program.ts');
  const binaryPath = sourceFile.replace(/\.ts$/, '');

  console.log('Compiling HTTP program...');

  try {
    execSync(`npx tsx src/index.ts ${sourceFile}`, {
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
    return { success: false, binaryPath, error: error.stderr || error.message };
  }
}

function startExpressServer(): ChildProcess {
  const serverPath = path.join(TESTS_DIR, 'reference-express-server.js');
  console.log('Starting Express reference server on port 3001...');

  const server = spawn('node', [serverPath, '3001'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return server;
}

function startChadScriptServer(binaryPath: string): ChildProcess {
  console.log('Starting ChadScript server on port 3000...');

  const server = spawn(binaryPath, [], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return server;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(port: number, method: string, path: string, body?: string): Promise<HttpResponse> {
  try {
    const url = `http://localhost:${port}${path}`;
    const options: RequestInit = {
      method,
      headers: body ? { 'Content-Type': 'text/plain' } : undefined,
      body
    };

    const response = await fetch(url, options);
    const responseBody = await response.text();

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      body: responseBody
    };
  } catch (error: any) {
    return {
      status: -1,
      headers: {},
      body: error.message
    };
  }
}

function compareResponses(express: HttpResponse, chadscript: HttpResponse, testCase: HttpTestCase): { passed: boolean; details?: string } {
  const issues: string[] = [];

  if (testCase.expectStatus !== undefined) {
    if (express.status !== testCase.expectStatus) {
      issues.push(`Express status ${express.status} doesn't match expected ${testCase.expectStatus}`);
    }
    if (chadscript.status !== testCase.expectStatus) {
      issues.push(`ChadScript status ${chadscript.status} doesn't match expected ${testCase.expectStatus}`);
    }
  } else {
    if (express.status !== chadscript.status) {
      issues.push(`Status mismatch: Express=${express.status}, ChadScript=${chadscript.status}`);
    }
  }

  if (testCase.expectBody !== undefined) {
    if (!express.body.includes(testCase.expectBody)) {
      issues.push(`Express body missing: "${testCase.expectBody}"`);
    }
    if (!chadscript.body.includes(testCase.expectBody)) {
      issues.push(`ChadScript body missing: "${testCase.expectBody}"`);
    }
  }

  if (testCase.expectHeader !== undefined) {
    const expressContentType = express.headers['content-type'] || '';
    const chadscriptContentType = chadscript.headers['content-type'] || '';

    if (!expressContentType.includes(testCase.expectHeader)) {
      issues.push(`Express Content-Type missing: "${testCase.expectHeader}"`);
    }
    if (!chadscriptContentType.includes(testCase.expectHeader)) {
      issues.push(`ChadScript Content-Type missing: "${testCase.expectHeader}"`);
    }
  }

  return {
    passed: issues.length === 0,
    details: issues.length > 0 ? issues.join('; ') : undefined
  };
}

async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const compile = compileHttpProgram();
  if (!compile.success) {
    console.error('HTTP program compilation failed');
    return [{
      name: 'compilation',
      passed: false,
      details: compile.error
    }];
  }

  const expressServer = startExpressServer();
  const chadscriptServer = startChadScriptServer(compile.binaryPath);

  await sleep(2000);

  try {
    console.log(`\nRunning ${HTTP_TEST_CASES.length} HTTP parity tests...\n`);

    for (let i = 0; i < HTTP_TEST_CASES.length; i++) {
      const tc = HTTP_TEST_CASES[i];
      const name = `http-${i + 1}: ${tc.method} ${tc.path}`;

      try {
        const expressResponse = await makeRequest(3001, tc.method, tc.path, tc.body);
        const chadscriptResponse = await makeRequest(3000, tc.method, tc.path, tc.body);

        const comparison = compareResponses(expressResponse, chadscriptResponse, tc);

        const result: TestResult = {
          name,
          passed: comparison.passed,
          expressResponse,
          chadscriptResponse,
          details: comparison.details
        };

        results.push(result);

        if (result.passed) {
          console.log(`✓ ${name}`);
        } else {
          console.log(`✗ ${name}`);
          console.log(`  Details: ${result.details}`);
          console.log(`  Express: status=${expressResponse.status}, body="${expressResponse.body.substring(0, 50)}"`);
          console.log(`  ChadScript: status=${chadscriptResponse.status}, body="${chadscriptResponse.body.substring(0, 50)}"`);
        }
      } catch (error: any) {
        results.push({
          name,
          passed: false,
          details: error.message
        });
        console.log(`✗ ${name} (exception: ${error.message})`);
      }
    }
  } finally {
    expressServer.kill();
    chadscriptServer.kill();
  }

  const passCount = results.filter(r => r.passed).length;
  console.log(`\n========================================`);
  console.log(`Results: ${passCount}/${results.length} passed`);
  console.log(`========================================\n`);

  return results;
}

function generateReport(results: TestResult[]): void {
  const reportPath = path.join(PROJECT_ROOT, 'agent-state', 'http-test-results.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results: results.map(r => ({
      name: r.name,
      passed: r.passed,
      details: r.details,
      expressStatus: r.expressResponse?.status,
      chadscriptStatus: r.chadscriptResponse?.status
    }))
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${reportPath}`);
}

runTests().then(results => {
  generateReport(results);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results));
  }

  const failCount = results.filter(r => !r.passed).length;
  process.exit(failCount > 0 ? 1 : 0);
}).catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
