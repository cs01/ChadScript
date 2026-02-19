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

const compiler = fsSync.existsSync('.build/chad') ? '.build/chad build' : 'node dist/chad-node.js build';
const compilerLabel = fsSync.existsSync('.build/chad') ? 'native' : 'node';

describe(`ChadScript Compiler (${compilerLabel})`, () => {
  describe('Compilation and Execution', { concurrency: 32 }, () => {
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
          await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`node dist/chad-node.js build --keep-temps ${fixturePath}`);

        // Read and verify LLVM IR
        const llContent = await fs.readFile(llFile, 'utf-8');

        // Check for essential LLVM IR components
        assert.ok(llContent.includes('define double @_cs_add'), 'Should define add function (mangled)');
        assert.ok(llContent.includes('define i32 @main'), 'Should define main function');
        assert.ok(llContent.includes('ret'), 'Should have return statements');
        assert.ok(llContent.includes('fadd fast double'), 'Should have add instruction');
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
        await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`${compiler} ${fixturePath}`);

        const { stdout } = await execAsync(`./${exeFile}`);

        assert.ok(stdout.includes('before try'), 'Should print before try');
        assert.ok(stdout.includes('in try block'), 'Should print in try block');
        assert.ok(stdout.includes('caught: test error'), 'Should catch the error');
        assert.ok(stdout.includes('after try-catch'), 'Should continue after try-catch');
        assert.ok(stdout.includes('TEST_PASSED'), 'Should print TEST_PASSED');
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

    it('should run finally blocks with and without exceptions', async () => {
      const fixturePath = 'tests/fixtures/error-handling/try-catch-finally.js';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const exeFile = path.join(outputDir, baseName);

      try {
        await execAsync(`${compiler} ${fixturePath}`);

        const { stdout } = await execAsync(`./${exeFile}`);

        assert.ok(stdout.includes('try catch finally'), 'Should run try, catch, and finally on throw');
        assert.ok(stdout.includes('try finally'), 'Should run try and finally without throw');
        assert.ok(stdout.includes('TEST_PASSED'), 'Should print TEST_PASSED');
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

    it('should handle nested try-catch correctly', async () => {
      const fixturePath = 'tests/fixtures/error-handling/try-catch-nested.js';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.js');
      const exeFile = path.join(outputDir, baseName);

      try {
        await execAsync(`${compiler} ${fixturePath}`);

        const { stdout } = await execAsync(`./${exeFile}`);

        assert.ok(stdout.includes('outer-try inner-try inner-catch after-inner outer-catch'), 'Nested try-catch should work');
        assert.ok(stdout.includes('TEST_PASSED'), 'Should print TEST_PASSED');
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

  describe('JSON Operations', () => {
    it('should parse JSON with JSON.parse()', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-parse-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        // Compile
        await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`${compiler} ${fixturePath}`);

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
        await execAsync(`${compiler} ${fixturePath}`);

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

    it('should parse JSON with boolean fields and array of parsed objects', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-parse-bool-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        await execAsync(`${compiler} ${fixturePath}`);
        const { stdout } = await execAsync(`./${exeFile}`);
        assert.ok(stdout.includes('TEST_PASSED'), 'JSON.parse() with boolean fields test should pass');
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

    it('should safely handle missing fields and invalid JSON', async () => {
      const fixturePath = 'tests/fixtures/builtins/json-safe-parse-test.ts';
      const outputDir = path.join('.build', path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, '.ts');
      const exeFile = path.join(outputDir, baseName);

      try {
        await execAsync(`${compiler} ${fixturePath}`);
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
        await execAsync(`${compiler} nonexistent.js`);
      }, 'Should throw error for missing file');
    });

    it('should reject any type in function parameters', async () => {
      const fixture = '/tmp/test-reject-any.ts';
      await fs.writeFile(fixture, 'function add(x: any, y: any): number { return x + y; }\nprocess.exit(add(5, 7));');
      try {
        await assert.rejects(async () => {
          await execAsync(`${compiler} ${fixture} -o /tmp/test-reject-any`);
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
          await execAsync(`${compiler} ${fixture} -o /tmp/test-reject-unknown`);
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

        await execAsync(`${compiler} ${fixture} -o ${exeFile}`);
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

  describe('Cross-compilation', () => {
    it('should emit linux stderr symbol when targeting linux', async () => {
      const fixture = 'tests/fixtures/arithmetic/simple-add.js';
      const outputDir = path.join('.build', path.dirname(fixture));
      const baseName = path.basename(fixture, '.js');
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target linux-x64 ${fixture}`);
        const ir = await fs.readFile(llFile, 'utf-8');
        assert.ok(ir.includes('@stderr = external global i8*'), 'Linux target should use external stderr');
        assert.ok(!ir.includes('__stderrp'), 'Linux target should not use __stderrp');
      } finally {
        try { if (fsSync.existsSync(llFile)) await fs.unlink(llFile); } catch {}
      }
    });

    it('should emit macOS stderr symbol when targeting macOS', async () => {
      const fixture = 'tests/fixtures/arithmetic/simple-add.js';
      const outputDir = path.join('.build', path.dirname(fixture));
      const baseName = path.basename(fixture, '.js');
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target macos-arm64 ${fixture}`);
        const ir = await fs.readFile(llFile, 'utf-8');
        assert.ok(ir.includes('@__stderrp = external global i8*'), 'macOS target should use __stderrp');
        assert.ok(ir.includes('@__stdoutp = external global i8*'), 'macOS target should use __stdoutp');
      } finally {
        try { if (fsSync.existsSync(llFile)) await fs.unlink(llFile); } catch {}
      }
    });

    it('should emit target triple in IR when --target is used', async () => {
      const fixture = 'tests/fixtures/arithmetic/simple-add.js';
      const outputDir = path.join('.build', path.dirname(fixture));
      const baseName = path.basename(fixture, '.js');
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target macos-arm64 ${fixture}`);
        const ir = await fs.readFile(llFile, 'utf-8');
        assert.ok(ir.includes('target triple = "aarch64-apple-darwin"'), 'Should contain target triple');
        assert.ok(ir.includes('target datalayout = "'), 'Should contain target datalayout');
      } finally {
        try { if (fsSync.existsSync(llFile)) await fs.unlink(llFile); } catch {}
      }
    });

    it('should bake target platform into process.platform', async () => {
      const fixture = '/tmp/test-cross-platform.ts';
      const fixtureContent = 'console.log(process.platform);\nconsole.log(process.arch);\n';
      await fs.writeFile(fixture, fixtureContent);
      const llFile = '/tmp/test-cross-platform.ll';

      try {
        await execAsync(`node dist/chad-node.js ir --target macos-arm64 ${fixture} -o /tmp/test-cross-platform`);
        const ir = await fs.readFile(llFile, 'utf-8');
        assert.ok(ir.includes('darwin'), 'Cross-compiled IR should contain darwin platform string');
        assert.ok(ir.includes('arm64'), 'Cross-compiled IR should contain arm64 arch string');
      } finally {
        try { await fs.unlink(fixture); } catch {}
        try { await fs.unlink(llFile); } catch {}
      }
    });
  });
});
