import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(exec);

interface TestCase {
  name: string;
  fixture: string;
  description: string;
  expectedExitCode?: number; // For legacy tests
  expectTestPassed?: boolean; // For new TEST_PASSED convention tests
  args?: string[]; // Optional command line arguments for the test
}

const testCases: TestCase[] = [
  {
    name: 'simple-add',
    fixture: 'tests/fixtures/arithmetic/simple-add.js',
    expectedExitCode: 12,
    description: 'Simple addition: add(5, 7) should return 12'
  },
  {
    name: 'simple-subtract',
    fixture: 'tests/fixtures/arithmetic/simple-subtract.js',
    expectedExitCode: 7,
    description: 'Simple subtraction: subtract(10, 3) should return 7'
  },
  {
    name: 'simple-multiply',
    fixture: 'tests/fixtures/arithmetic/simple-multiply.js',
    expectedExitCode: 42,
    description: 'Simple multiplication: multiply(6, 7) should return 42'
  },
  {
    name: 'simple-divide',
    fixture: 'tests/fixtures/arithmetic/simple-divide.js',
    expectedExitCode: 5,
    description: 'Simple division: divide(20, 4) should return 5'
  },
  {
    name: 'simple-modulo',
    fixture: 'tests/fixtures/arithmetic/simple-modulo.js',
    expectedExitCode: 2,
    description: 'Simple modulo: modulo(17, 5) should return 2'
  },
  {
    name: 'math-functions',
    fixture: 'tests/fixtures/arithmetic/math-functions.js',
    expectedExitCode: 0,
    description: 'Test all Math functions'
  },
  {
    name: 'math-lib',
    fixture: 'tests/fixtures/arithmetic/math-lib.js',
    expectedExitCode: 0,
    description: 'Math library - exported functions'
  },
  {
    name: 'nested-calls',
    fixture: 'tests/fixtures/arithmetic/nested-calls.js',
    expectedExitCode: 17,
    description: 'Nested function calls: calculate(4, 5) should return 17'
  },
  {
    name: 'operator-precedence',
    fixture: 'tests/fixtures/arithmetic/operator-precedence.js',
    expectedExitCode: 14,
    description: 'Operator precedence: compute(2, 3, 4) should return 14'
  },
  {
    name: 'complex-expression',
    fixture: 'tests/fixtures/arithmetic/complex-expression.js',
    expectedExitCode: 32,
    description: 'Complex expression: complex(5, 6, 10, 8) should return 32'
  },
  {
    name: 'multiple-params',
    fixture: 'tests/fixtures/arithmetic/multiple-params.js',
    expectedExitCode: 15,
    description: 'Multiple parameters: sum(1, 2, 3, 4, 5) should return 15'
  },
  {
    name: 'chained-calls',
    fixture: 'tests/fixtures/arithmetic/chained-calls.js',
    expectedExitCode: 17,
    description: 'Chained function calls: combined(2, 3, 4) should return 17'
  },
  {
    name: 'if-else',
    fixture: 'tests/fixtures/control-flow/if-else.js',
    expectedExitCode: 15,
    description: 'If-else statement: max(15, 10) should return 15'
  },
  {
    name: 'logical-operators',
    fixture: 'tests/fixtures/logical/logical-operators.js',
    expectedExitCode: 5,
    description: 'Logical operators: testOr(0, 5) should return 5'
  },
  {
    name: 'imports-main',
    fixture: 'tests/fixtures/imports-exports/imports-main.js',
    expectedExitCode: 19,
    description: 'Import/Export: multi-file compilation should work'
  },
  {
    name: 'string-length',
    fixture: 'tests/fixtures/strings/string-length.js',
    expectedExitCode: 5,
    description: 'String .length property should return correct length'
  },
  {
    name: 'string-split-length',
    fixture: 'tests/fixtures/strings/string-split-length.ts',
    expectTestPassed: true,
    description: 'README example: string.split() should work correctly and element.length should return proper lengths'
  },
  {
    name: 'string-index',
    fixture: 'tests/fixtures/strings/string-index.js',
    expectedExitCode: 66,
    description: 'String indexing should return character code'
  },
  {
    name: 'string-literal',
    fixture: 'tests/fixtures/strings/string-literal.js',
    expectedExitCode: 4,
    description: 'String literal in variable should work'
  },
  {
    name: 'string-concat',
    fixture: 'tests/fixtures/strings/string-concat.js',
    expectedExitCode: 10,
    description: 'String concatenation should work'
  },
  {
    name: 'string-substr',
    fixture: 'tests/fixtures/strings/string-substr.js',
    expectedExitCode: 3,
    description: 'String substr() method should work'
  },
  {
    name: 'string-concat-method',
    fixture: 'tests/fixtures/strings/string-concat-method.js',
    expectedExitCode: 11,
    description: 'String concat() method should work'
  },
  {
    name: 'string-repeat',
    fixture: 'tests/fixtures/strings/string-repeat.js',
    expectedExitCode: 6,
    description: 'String repeat() method should work'
  },
  {
    name: 'string-padstart',
    fixture: 'tests/fixtures/strings/string-padstart.js',
    expectedExitCode: 3,
    description: 'String padStart() method should work'
  },
  {
    name: 'process-argv',
    fixture: 'tests/fixtures/builtins/process-argv-test.ts',
    expectTestPassed: true,
    description: 'process.argv should provide command line arguments',
    args: ['testarg'] // Pass "testarg" as first argument
  },
  {
    name: 'fs-readFileSync',
    fixture: 'tests/fixtures/builtins/fs-readfile-test.ts',
    expectTestPassed: true,
    description: 'fs.readFileSync should read file contents correctly'
  },
  {
    name: 'word-count',
    fixture: 'tests/fixtures/builtins/word-count-test.ts',
    expectTestPassed: true,
    description: 'Word counting with for loops, split, and file reading'
  },
  {
    name: 'console-log',
    fixture: 'tests/fixtures/builtins/console-log.js',
    expectTestPassed: true,
    description: 'console.log and console.error should output correctly'
  },
  {
    name: 'parseint',
    fixture: 'tests/fixtures/builtins/parseint.js',
    expectTestPassed: true,
    description: 'parseInt should parse numbers with different radixes'
  },
  {
    name: 'argv-debug',
    fixture: 'tests/fixtures/builtins/argv-debug.ts',
    expectedExitCode: 0,
    description: 'Debug process.argv'
  },
  {
    name: 'argv-simple',
    fixture: 'tests/fixtures/builtins/argv-simple.ts',
    expectedExitCode: 0,
    description: 'Test argv with no user arguments'
  },
  {
    name: 'fs-readFileSync-simple',
    fixture: 'tests/fixtures/builtins/fs-readFileSync.js',
    expectedExitCode: 0,
    description: 'fs.readFileSync basic test'
  },
  {
    name: 'process-argv-simple',
    fixture: 'tests/fixtures/builtins/process-argv.js',
    expectedExitCode: 0,
    description: 'process.argv basic test'
  },
  {
    name: 'array-includes',
    fixture: 'tests/fixtures/arrays/array-includes-test.js',
    expectTestPassed: true,
    description: 'Array .includes() should find elements correctly'
  },
  {
    name: 'array-pop',
    fixture: 'tests/fixtures/arrays/array-pop-test.js',
    expectTestPassed: true,
    description: 'Array .pop() should remove and return last element'
  },
  {
    name: 'array-methods',
    fixture: 'tests/fixtures/arrays/array-methods.js',
    expectedExitCode: 0,
    description: 'Array methods (pop, includes) should work'
  },
  {
    name: 'string-array-concat',
    fixture: 'tests/fixtures/arrays/string-array-concat.js',
    expectedExitCode: 0,
    description: 'String array concatenation should work'
  },
  {
    name: 'string-array-index',
    fixture: 'tests/fixtures/arrays/string-array-index.js',
    expectedExitCode: 0,
    description: 'String array indexing should work'
  },
  {
    name: 'string-trim',
    fixture: 'tests/fixtures/strings/string-trim-simple.ts',
    expectTestPassed: true,
    description: 'String .trim() should remove leading and trailing whitespace'
  },
  {
    name: 'string-methods',
    fixture: 'tests/fixtures/strings/string-methods.js',
    expectedExitCode: 0,
    description: 'Test new string methods: trim, indexOf, includes, slice'
  },
  {
    name: 'simple-if',
    fixture: 'tests/fixtures/control-flow/simple-if.ts',
    expectTestPassed: true,
    description: 'Simple if statement should work'
  },
  {
    name: 'ternary-complex',
    fixture: 'tests/fixtures/control-flow/ternary-complex.js',
    expectTestPassed: true,
    description: 'Nested ternary expressions should work'
  },
  {
    name: 'ternary-nested',
    fixture: 'tests/fixtures/control-flow/ternary-nested.js',
    expectTestPassed: true,
    description: 'Deeply nested ternary expressions should work'
  },
  {
    name: 'if-only',
    fixture: 'tests/fixtures/control-flow/if-only.js',
    expectTestPassed: true,
    description: 'If statement without else should work'
  },
  {
    name: 'for-of-comprehensive',
    fixture: 'tests/fixtures/control-flow/for-of-comprehensive.ts',
    expectTestPassed: true,
    description: 'for...of loops over numeric arrays, string arrays, and with break'
  },
  {
    name: 'string-length-check',
    fixture: 'tests/fixtures/strings/string-length-check.ts',
    expectTestPassed: true,
    description: 'String length comparisons should work'
  },
  {
    name: 'string-array-basic',
    fixture: 'tests/fixtures/arrays/string-array-basic.js',
    expectTestPassed: true,
    description: 'String array creation and access should work'
  },
  {
    name: 'regex-test',
    fixture: 'tests/fixtures/regex/regex-test.js',
    expectedExitCode: 1,
    description: 'Regex test() method should work'
  },
  {
    name: 'regex-constructor',
    fixture: 'tests/fixtures/regex/regex-constructor.ts',
    expectTestPassed: true,
    description: 'new RegExp() constructor with flags (i, m) and dynamic patterns'
  },
  {
    name: 'array-literal',
    fixture: 'tests/fixtures/arrays/array-literal.js',
    expectedExitCode: 3,
    description: 'Array literal and .length should work'
  },
  {
    name: 'array-index',
    fixture: 'tests/fixtures/arrays/array-index.js',
    expectedExitCode: 20,
    description: 'Array indexing should work'
  },
  {
    name: 'array-push',
    fixture: 'tests/fixtures/arrays/array-push.js',
    expectedExitCode: 4,
    description: 'Array .push() should add element and return new length'
  },
  {
    name: 'array-find',
    fixture: 'tests/fixtures/arrays/array-find.js',
    expectedExitCode: 3,
    description: 'Array .find() should return first matching element'
  },
  {
    name: 'array-some',
    fixture: 'tests/fixtures/arrays/array-some.js',
    expectedExitCode: 1,
    description: 'Array .some() should return 1 if any element matches'
  },
  {
    name: 'array-filter',
    fixture: 'tests/fixtures/arrays/array-filter.js',
    expectedExitCode: 3,
    description: 'Array .filter() should return new array with matching elements'
  },
  {
    name: 'array-foreach',
    fixture: 'tests/fixtures/arrays/array-foreach.js',
    expectedExitCode: 10,
    description: 'Array .forEach() should call function for each element'
  },
  {
    name: 'array-slice',
    fixture: 'tests/fixtures/arrays/array-slice.ts',
    expectTestPassed: true,
    description: 'Array .slice() should return a new array with selected elements'
  },
  {
    name: 'object-literal',
    fixture: 'tests/fixtures/objects/object-literal.js',
    expectedExitCode: 30,
    description: 'Object literal and property access should work'
  },
  {
    name: 'object-nested',
    fixture: 'tests/fixtures/objects/object-nested.js',
    expectedExitCode: 12,
    description: 'Object with complex property expressions should work'
  },
  {
    name: 'object-return',
    fixture: 'tests/fixtures/objects/object-return.js',
    expectedExitCode: 42,
    description: 'Returning object property should work'
  },
  {
    name: 'object-literal-access',
    fixture: 'tests/fixtures/objects/object-literal-access.js',
    expectedExitCode: 10,
    description: 'Property access on object literal should work'
  },
  {
    name: 'object-keys',
    fixture: 'tests/fixtures/builtins/object-keys.ts',
    expectTestPassed: true,
    description: 'Object.keys() should return field names of typed objects'
  },
  {
    name: 'typeof',
    fixture: 'tests/fixtures/builtins/typeof.ts',
    expectTestPassed: true,
    description: 'typeof operator should return correct type strings'
  },
    {
      name: 'object-method',
      fixture: 'tests/fixtures/objects/object-method.js',
    expectedExitCode: 12,
      description: 'Object method call should work'
    },
    {
      name: 'class-basic',
      fixture: 'tests/fixtures/classes/class-basic.js',
    expectedExitCode: 10,
      description: 'Class with constructor, methods, and this should work'
    },
    {
      name: 'while-loop',
      fixture: 'tests/fixtures/control-flow/while-loop.js',
    expectedExitCode: 15,
      description: 'While loop should sum numbers from 5 to 1'
    },
    {
      name: 'for-loop',
      fixture: 'tests/fixtures/control-flow/for-loop.js',
    expectedExitCode: 55,
      description: 'For loop should sum numbers from 1 to 10'
    },
    {
      name: 'loop-break',
      fixture: 'tests/fixtures/control-flow/loop-break.js',
    expectedExitCode: 43,
      description: 'Break statement should exit loop early'
    },
    {
      name: 'loop-continue',
      fixture: 'tests/fixtures/control-flow/loop-continue.js',
    expectedExitCode: 12,
      description: 'Continue statement should skip to next iteration'
    },
    {
      name: 'map-basic',
      fixture: 'tests/fixtures/data-structures/map-basic.js',
      expectTestPassed: true,
      description: 'Map with set/get operations should work'
    },
    {
      name: 'set-basic',
      fixture: 'tests/fixtures/data-structures/set-basic.js',
    expectedExitCode: 1,
      description: 'Set with add/has operations should work'
    },
    {
      name: 'strict-equality',
      fixture: 'tests/fixtures/comparisons/strict-equality.js',
    expectedExitCode: 15,
      description: 'Strict equality (===) and inequality (!==) operators should work'
    },
    {
      name: 'ternary',
      fixture: 'tests/fixtures/control-flow/ternary.js',
    expectedExitCode: 15,
      description: 'Ternary operator (? :) should work'
    },
    {
      name: 'function-expression',
      fixture: 'tests/fixtures/functions/function-expression.js',
    expectedExitCode: 0,
      description: 'Function expressions in array methods should work'
    },
    {
      name: 'return-boolean',
      fixture: 'tests/fixtures/edge-cases/return-boolean.js',
    expectedExitCode: 1,
      description: 'Boolean literals (true/false) should work'
    },
    {
      name: 'shebang',
      fixture: 'tests/fixtures/edge-cases/shebang.js',
      expectedExitCode: 0,
      description: 'Shebang line should be handled correctly'
    },
    {
      name: 'bitwise-operators',
      fixture: 'tests/fixtures/bitwise/bitwise-operators.js',
      expectedExitCode: 0,
      description: 'Test all bitwise operators'
    },
    {
      name: 'throw-simple',
      fixture: 'tests/fixtures/error-handling/throw-simple.js',
      expectedExitCode: 0,
      description: 'Simple throw statement'
    },
    {
      name: 'try-catch-throw',
      fixture: 'tests/fixtures/error-handling/try-catch-throw.js',
      expectedExitCode: 0,
      description: 'Try-catch-throw flow'
    },
    {
      name: 'http-simple-test',
      fixture: 'tests/fixtures/network/http-simple-test.ts',
      expectedExitCode: 0,
      description: 'Simplified HTTP handler test'
    },
    {
      name: 'tcp-echo-server',
      fixture: 'tests/fixtures/network/tcp-echo-server.ts',
      expectedExitCode: 0,
      description: 'TCP Echo Server - Functional style without interface returns'
    },
    {
      name: 'typescript-struct',
      fixture: 'tests/fixtures/typescript/typescript-struct.ts',
    expectedExitCode: 7,
      description: 'TypeScript interface with struct property access should work'
    },
    {
      name: 'array-init-safe',
      fixture: 'tests/fixtures/arrays/array-init-safe.ts',
    expectedExitCode: 10,
      description: 'Array initialization should be zero-initialized to prevent crashes on iteration'
    },
    // Regression tests for float/double conversion edge cases
    {
      name: 'array-index-float-conversion',
      fixture: 'tests/fixtures/edge-cases/array-index-float-conversion.js',
    expectedExitCode: 30,
      description: 'Array indexing with float values should convert to int (regression test)'
    },
    {
      name: 'string-length-arithmetic',
      fixture: 'tests/fixtures/edge-cases/string-length-arithmetic.js',
    expectedExitCode: 10,
      description: 'String.length in arithmetic should convert i32 to double (regression test)'
    },
    {
      name: 'array-length-comparison',
      fixture: 'tests/fixtures/edge-cases/array-length-comparison.js',
    expectedExitCode: 42,
      description: 'Array.length in comparisons should convert properly (regression test)'
    },
    {
      name: 'array-length-multiplication',
      fixture: 'tests/fixtures/edge-cases/array-indexof-arithmetic.js',
    expectedExitCode: 20,
      description: 'Array.length in multiplication should convert i32 to double (regression test)'
    },
    {
      name: 'bitwise-float-conversion',
      fixture: 'tests/fixtures/edge-cases/bitwise-float-conversion.js',
    expectedExitCode: 8,
      description: 'Bitwise operations with floats should convert to integers (regression test)'
    },
    {
      name: 'object-destructure',
      fixture: 'tests/fixtures/destructuring/object-destructure.ts',
      expectTestPassed: true,
      description: 'Object destructuring const { x, y } = obj should work'
    },
    {
      name: 'object-destructure-rename',
      fixture: 'tests/fixtures/destructuring/object-destructure-rename.ts',
      expectTestPassed: true,
      description: 'Object destructuring with renaming const { host: h } = obj should work'
    },
    {
      name: 'array-destructure',
      fixture: 'tests/fixtures/destructuring/array-destructure.ts',
      expectTestPassed: true,
      description: 'Array destructuring const [a, b, c] = arr should work'
    },
    {
      name: 'array-reduce',
      fixture: 'tests/fixtures/arrays/array-reduce.ts',
      expectTestPassed: true,
      description: 'Array.reduce() with named function, arrow function, and no initial value'
    },
    {
      name: 'array-spread',
      fixture: 'tests/fixtures/arrays/array-spread.ts',
      expectTestPassed: true,
      description: 'Spread operator in array literals [...arr, x] should work'
    },
    {
      name: 'rest-params',
      fixture: 'tests/fixtures/functions/rest-params.ts',
      expectTestPassed: true,
      description: 'Rest parameters function(...args) with spread call syntax should work'
    },
    {
      name: 'string-replaceall',
      fixture: 'tests/fixtures/strings/string-replaceall.ts',
      expectTestPassed: true,
      description: 'String.replaceAll() should replace all occurrences of a substring'
    },
    {
      name: 'string-trim-variants',
      fixture: 'tests/fixtures/strings/string-trim-variants.ts',
      expectTestPassed: true,
      description: 'String.trimStart() and trimEnd() should trim whitespace from one side'
    },
    {
      name: 'array-isarray',
      fixture: 'tests/fixtures/arrays/array-isarray.ts',
      expectTestPassed: true,
      description: 'Array.isArray() should return true for arrays and false for non-arrays'
    },
    {
      name: 'process-platform',
      fixture: 'tests/fixtures/builtins/process-platform.ts',
      expectTestPassed: true,
      description: 'process.platform should return the current platform string'
    },
    {
      name: 'number-methods',
      fixture: 'tests/fixtures/builtins/number-methods.ts',
      expectTestPassed: true,
      description: 'Number.isFinite(), Number.isNaN(), Number.isInteger(), Number.toString()'
    },
    {
      name: 'process-stdout-write',
      fixture: 'tests/fixtures/builtins/process-stdout-write.ts',
      expectTestPassed: true,
      description: 'process.stdout.write() should output without trailing newline'
    },
    {
      name: 'object-values-entries',
      fixture: 'tests/fixtures/builtins/object-values-entries.ts',
      expectTestPassed: true,
      description: 'Object.values() and Object.entries() should return object field values'
    },
    {
      name: 'process-env',
      fixture: 'tests/fixtures/builtins/process-env.ts',
      expectTestPassed: true,
      description: 'process.env should read environment variables via getenv()'
    },
    {
      name: 'process-properties',
      fixture: 'tests/fixtures/builtins/process-properties.ts',
      expectTestPassed: true,
      description: 'process.arch, version, pid, ppid, execPath, argv0'
    },
    {
      name: 'process-methods',
      fixture: 'tests/fixtures/builtins/process-methods.ts',
      expectTestPassed: true,
      description: 'process.getuid, getgid, geteuid, getegid, uptime, chdir, kill'
    },
    {
      name: 'tty-isatty',
      fixture: 'tests/fixtures/builtins/tty-isatty.ts',
      expectTestPassed: true,
      description: 'tty.isatty() syscall for terminal detection'
    }
  ];

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
        assert.ok(llContent.includes('define double @add'), 'Should define add function');
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
  });

  describe('Error Handling', () => {
    it('should handle missing input file', async () => {
      await assert.rejects(async () => {
        await execAsync('node dist/index.js nonexistent.js');
      }, 'Should throw error for missing file');
    });
  });
});
