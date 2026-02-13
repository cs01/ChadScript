import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { testCases } from './test-fixtures';

const execAsync = promisify(exec);

describe('ChadScript Compiler', () => {
  describe('Compilation and Execution', { concurrency: 8 }, () => {
    for (const testCase of testCases) {
      it(testCase.description, async () => {
        const fixturePath = testCase.fixture; // Use relative path, not resolved
        // Binaries now go in .build/ directory
        const fixtureDir = path.dirname(testCase.fixture);
        const outputDir = path.join('.build', fixtureDir);
        const extension = path.extname(fixturePath);
        const baseName = path.basename(fixturePath, extension);
        const llFile = path.join(outputDir, `${baseName}.ll`);
        const exeFile = path.join(outputDir, baseName);

        // Clean up any previous build artifacts
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }

        try {
          // Compile the fixture (no console.log to avoid parallel output issues)
          await execAsync(`node dist/index.js ${fixturePath}`);

          // Verify executable was generated (intermediate files are cleaned up by default)
          assert.ok(
            fsSync.existsSync(exeFile),
            `Executable should exist at ${exeFile}`
          );

          // Run the executable and check result based on test type
          try {
            // Build command with optional arguments
            const args = testCase.args ? testCase.args.join(' ') : '';
            const command = args ? `${exeFile} ${args}` : exeFile;

            let result;
            let actualExitCode = 0;

            try {
              result = await execAsync(command);
              actualExitCode = 0;
            } catch (err: any) {
              actualExitCode = err.code || err.status || 1;
              result = err; // Preserve stdout/stderr from error
            }

            // Check based on test convention
            if (testCase.expectTestPassed) {
              // New convention: check for TEST_PASSED in stdout
              const stdout = result.stdout || '';
              if (!stdout.includes('TEST_PASSED')) {
                throw new Error(`Test did not print TEST_PASSED. stdout: ${stdout}. stderr: ${result.stderr || ''}`);
              }
              assert.strictEqual(actualExitCode, 0);
            } else if (testCase.expectedExitCode !== undefined) {
              // Legacy convention: check exit code
              assert.strictEqual(
                actualExitCode,
                testCase.expectedExitCode,
                `Expected exit code ${testCase.expectedExitCode}, got ${actualExitCode}`
              );
            } else {
              throw new Error('Test must specify either expectedExitCode or expectTestPassed');
            }
          } catch (err: any) {
            throw err;
          }
        } finally {
          // Clean up build artifacts after test
          try {
            if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
            if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    }
  });

  describe('LLVM IR Generation', () => {
    it('should generate valid LLVM IR structure', async () => {
      const fixturePath = 'tests/fixtures/arithmetic/simple-add.js'; // Use relative path
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const llFile = path.join(outputDir, `${baseName}.ll`);

      // Clean up
      try {
        if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
      } catch (err) {
        // Ignore
      }

      try {
        // Compile with --keep-temps to preserve .ll file for inspection
        await execAsync(`node dist/index.js --keep-temps ${fixturePath}`);

        // Read and verify LLVM IR
        const llContent = await fs.readFile(llFile, 'utf-8');

        // Check for essential LLVM IR components
        assert.ok(llContent.includes('define double @_cs_add'), 'Should define add function (mangled)');
        assert.ok(llContent.includes('define i32 @main'), 'Should define main function');
        assert.ok(llContent.includes('ret'), 'Should have return statements');
        assert.ok(llContent.includes('fadd double'), 'Should have add instruction');
      } finally {
        // Clean up
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          const exeFile = path.join(outputDir, baseName);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore
        }
      }
    });
  });

  describe('Bitwise Operators', () => {
    it('should compile and execute bitwise operators (XOR, shifts, AND, OR)', async () => {
      const fixturePath = 'tests/fixtures/bitwise/bitwise-operators.js';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check expected outputs
        assert.ok(stdout.includes('XOR(5,3)=6'), 'XOR should return 6');
        assert.ok(stdout.includes('LeftShift(5,2)=20'), 'Left shift should return 20');
        assert.ok(stdout.includes('RightShift(20,2)=5'), 'Right shift should return 5');
        assert.ok(stdout.includes('AND(12,10)=8'), 'AND should return 8');
        assert.ok(stdout.includes('OR(12,10)=14'), 'OR should return 14');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Math Functions', () => {
    it('should compile and execute Math functions (sqrt, pow, floor, ceil, round, abs)', async () => {
      const fixturePath = 'tests/fixtures/arithmetic/math-functions.js';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check expected outputs
        assert.ok(stdout.includes('sqrt(16)=4'), 'sqrt(16) should return 4');
        assert.ok(stdout.includes('pow(2,8)=256'), 'pow(2,8) should return 256');
        assert.ok(stdout.includes('floor(3.7)=3'), 'floor(3.7) should return 3');
        assert.ok(stdout.includes('ceil(3.2)=4'), 'ceil(3.2) should return 4');
        assert.ok(stdout.includes('round(3.5)=4'), 'round(3.5) should return 4');
        assert.ok(stdout.includes('round(3.4)=3'), 'round(3.4) should return 3');
        assert.ok(stdout.includes('abs(-42)=42'), 'abs(-42) should return 42');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Try/Catch/Throw', () => {
    it('should compile and execute try-catch-throw syntax', async () => {
      const fixturePath = 'tests/fixtures/error-handling/try-catch-throw.js';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout, stderr } = await execAsync(`./${exeFile}`);
        const output = stdout + stderr;

        // Check that try block executed
        assert.ok(output.includes('before try'), 'Should print before try');
        assert.ok(output.includes('in try block'), 'Should print in try block');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('JSON Operations', () => {
    it('should parse JSON with JSON.parse()', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-parse-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check for test passed
        assert.ok(stdout.includes('TEST_PASSED'), 'JSON.parse() test should pass');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });

    it('should stringify values with JSON.stringify()', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-stringify-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check for test passed
        assert.ok(stdout.includes('TEST_PASSED'), 'JSON.stringify() test should pass');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });

    it('should pretty print JSON data', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-pretty-print-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check that pretty printing worked
        assert.ok(stdout.includes('Repository Information:'), 'Should include header');
        assert.ok(stdout.includes('TypeScript'), 'Should include language name');
        assert.ok(stdout.includes('TEST_PASSED'), 'Pretty print test should pass');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });

    it('should format console output correctly', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-typed-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`node dist/index.js ${fixturePath}`);

        // Run and capture output
        const { stdout } = await execAsync(`./${exeFile}`);

        // Check output formatting
        assert.ok(stdout.includes('Laptop'), 'Product name should be present');
        assert.ok(stdout.includes('Electronics'), 'Category should be present');
        assert.ok(stdout.includes('TEST_PASSED'), 'Test should pass');
      } finally {
        // Clean up
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });

    it('should safely handle missing fields and invalid JSON', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-safe-parse-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        await execAsync(`node dist/index.js ${fixturePath}`);
        const { stdout } = await execAsync(`./${exeFile}`);
        assert.ok(stdout.includes('TEST_PASSED'), 'JSON safe parse test should pass');
      } finally {
        try {
          const llFile = path.join(outputDir, `${baseName}.ll`);
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing input file', async () => {
      await assert.rejects(async () => {
        await execAsync('node dist/index.js nonexistent.js');
      }, 'Should throw error for missing file');
    });

    it('should reject any type in function parameters', async () => {
      const fixture = '/tmp/test-reject-any.ts';
      await fs.writeFile(fixture, 'function add(x: any, y: any): number { return x + y; }\nprocess.exit(add(5, 7));');
      try {
        await assert.rejects(async () => {
          await execAsync(`node dist/index.js ${fixture} -o /tmp/test-reject-any`);
        }, (err: any) => {
          assert.ok(err.stderr.includes("'any' is not allowed") || err.message.includes("'any' is not allowed"),
            `Expected error about 'any' type, got: ${err.stderr || err.message}`);
          return true;
        });
      } finally {
        try { await fs.unlink(fixture); } catch {}
        try { await fs.unlink('/tmp/test-reject-any'); } catch {}
      }
    });

    it('should reject unknown type in function parameters', async () => {
      const fixture = '/tmp/test-reject-unknown.ts';
      await fs.writeFile(fixture, 'function add(x: unknown, y: unknown): number { return x + y; }\nprocess.exit(add(5, 7));');
      try {
        await assert.rejects(async () => {
          await execAsync(`node dist/index.js ${fixture} -o /tmp/test-reject-unknown`);
        }, (err: any) => {
          assert.ok(err.stderr.includes("'unknown' is not allowed") || err.message.includes("'unknown' is not allowed"),
            `Expected error about 'unknown' type, got: ${err.stderr || err.message}`);
          return true;
        });
      } finally {
        try { await fs.unlink(fixture); } catch {}
        try { await fs.unlink('/tmp/test-reject-unknown'); } catch {}
      }
    });
  });

  describe('Network tests', () => {
    it('should access response properties (url, statusText, redirected, headers)', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Test': 'hello' });
        res.end('test body');
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address() as { port: number };
      const port = addr.port;

      try {
        const fixture = '/tmp/test-response-properties.ts';
        const fixtureContent = `async function main(): Promise<void> {
  const response = await fetch("http://127.0.0.1:${port}/");

  const status = response.status;
  console.log(status);

  const ok = response.ok;
  console.log(ok);

  const body = response.text();
  console.log(body);

  const url = response.url;
  console.log(url);

  const statusText = response.statusText;
  console.log(statusText);

  const redirected = response.redirected;
  console.log(redirected);

  const headers = response.headers;
  console.log(headers);

  console.log("TEST_PASSED");
}

await main();
`;
        await fs.writeFile(fixture, fixtureContent);
        const exeFile = '/tmp/test-response-properties';
        try { if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile); } catch {}

        await execAsync(`node dist/index.js ${fixture} -o ${exeFile}`);
        assert.ok(fsSync.existsSync(exeFile), `Executable should exist at ${exeFile}`);

        const result = await execAsync(exeFile);
        const stdout = result.stdout;

        assert.ok(stdout.includes('200'), `Expected stdout to contain '200', got: ${stdout}`);
        assert.ok(stdout.includes('OK'), `Expected stdout to contain 'OK', got: ${stdout}`);
        assert.ok(stdout.includes('test body'), `Expected stdout to contain 'test body', got: ${stdout}`);
        assert.ok(stdout.includes(`http://127.0.0.1:${port}/`), `Expected stdout to contain url, got: ${stdout}`);
        assert.ok(stdout.includes('TEST_PASSED'), `Expected stdout to contain TEST_PASSED, got: ${stdout}`);
      } finally {
        server.close();
        try { await fs.unlink('/tmp/test-response-properties.ts'); } catch {}
        try { await fs.unlink('/tmp/test-response-properties'); } catch {}
      }
    });
  });
});
