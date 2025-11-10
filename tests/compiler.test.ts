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
  expectedExitCode: number;
  description: string;
}

const testCases: TestCase[] = [
  {
    name: 'simple-add',
    fixture: 'tests/fixtures/simple-add.js',
    expectedExitCode: 12, // 5 + 7
    description: 'Simple addition: add(5, 7) should return 12'
  },
  {
    name: 'simple-subtract',
    fixture: 'tests/fixtures/simple-subtract.js',
    expectedExitCode: 7, // 10 - 3
    description: 'Simple subtraction: subtract(10, 3) should return 7'
  },
  {
    name: 'simple-multiply',
    fixture: 'tests/fixtures/simple-multiply.js',
    expectedExitCode: 42, // 6 * 7
    description: 'Simple multiplication: multiply(6, 7) should return 42'
  },
  {
    name: 'simple-divide',
    fixture: 'tests/fixtures/simple-divide.js',
    expectedExitCode: 5, // 20 / 4
    description: 'Simple division: divide(20, 4) should return 5'
  },
  {
    name: 'nested-calls',
    fixture: 'tests/fixtures/nested-calls.js',
    expectedExitCode: 17, // 4 * 5 - 3
    description: 'Nested function calls: calculate(4, 5) should return 17'
  },
  {
    name: 'operator-precedence',
    fixture: 'tests/fixtures/operator-precedence.js',
    expectedExitCode: 14, // 2 + 3 * 4 = 2 + 12
    description: 'Operator precedence: compute(2, 3, 4) should return 14'
  },
  {
    name: 'complex-expression',
    fixture: 'tests/fixtures/complex-expression.js',
    expectedExitCode: 32, // 5 * 6 + 10 - 8 = 30 + 10 - 8
    description: 'Complex expression: complex(5, 6, 10, 8) should return 32'
  },
  {
    name: 'multiple-params',
    fixture: 'tests/fixtures/multiple-params.js',
    expectedExitCode: 15, // 1 + 2 + 3 + 4 + 5
    description: 'Multiple parameters: sum(1, 2, 3, 4, 5) should return 15'
  },
  {
    name: 'chained-calls',
    fixture: 'tests/fixtures/chained-calls.js',
    expectedExitCode: 17, // add(2, 3) + multiply(3, 4) = 5 + 12
    description: 'Chained function calls: combined(2, 3, 4) should return 17'
  },
  {
    name: 'if-else',
    fixture: 'tests/fixtures/if-else.js',
    expectedExitCode: 15, // max(15, 10) should return 15
    description: 'If-else statement: max(15, 10) should return 15'
  },
  {
    name: 'logical-operators',
    fixture: 'tests/fixtures/logical-operators.js',
    expectedExitCode: 1, // testOr(0, 5): 0 || 5 = 1 (truthy)
    description: 'Logical operators: testOr(0, 5) should return 1'
  },
  {
    name: 'imports-main',
    fixture: 'tests/fixtures/imports-main.js',
    expectedExitCode: 19, // add(3,4) + multiply(3,4) = 7 + 12 = 19
    description: 'Import/Export: multi-file compilation should work'
  },
  {
    name: 'string-length',
    fixture: 'tests/fixtures/string-length.js',
    expectedExitCode: 5, // "Hello".length = 5
    description: 'String .length property should return correct length'
  },
  {
    name: 'string-index',
    fixture: 'tests/fixtures/string-index.js',
    expectedExitCode: 66, // "ABC"[1] = 'B' = ASCII 66
    description: 'String indexing should return character code'
  },
  {
    name: 'string-literal',
    fixture: 'tests/fixtures/string-literal.js',
    expectedExitCode: 4, // "test".length = 4
    description: 'String literal in variable should work'
  },
  {
    name: 'string-concat',
    fixture: 'tests/fixtures/string-concat.js',
    expectedExitCode: 10, // "Hello" + "World" = 10 chars
    description: 'String concatenation should work'
  },
  {
    name: 'string-substr',
    fixture: 'tests/fixtures/string-substr.js',
    expectedExitCode: 3, // "Hello".substr(1, 3) = "ell" = 3 chars
    description: 'String substr() method should work'
  },
  {
    name: 'array-literal',
    fixture: 'tests/fixtures/array-literal.js',
    expectedExitCode: 3, // [1, 2, 3].length = 3
    description: 'Array literal and .length should work'
  },
  {
    name: 'array-index',
    fixture: 'tests/fixtures/array-index.js',
    expectedExitCode: 20, // [10, 20, 30][1] = 20
    description: 'Array indexing should work'
  },
  {
    name: 'array-push',
    fixture: 'tests/fixtures/array-push.js',
    expectedExitCode: 4, // [10, 20, 30].push(40) returns 4 (new length)
    description: 'Array .push() should add element and return new length'
  },
  {
    name: 'array-find',
    fixture: 'tests/fixtures/array-find.js',
    expectedExitCode: 3, // [1, 2, 3, 4].find(isGreaterThan2) returns 3
    description: 'Array .find() should return first matching element'
  },
  {
    name: 'array-some',
    fixture: 'tests/fixtures/array-some.js',
    expectedExitCode: 1, // [1, 2, 3, 10].some(isGreaterThan5) returns 1 (true)
    description: 'Array .some() should return 1 if any element matches'
  },
  {
    name: 'array-filter',
    fixture: 'tests/fixtures/array-filter.js',
    expectedExitCode: 3, // [1, 2, 3, 4, 5].filter(isGreaterThan2) returns [3, 4, 5], length is 3
    description: 'Array .filter() should return new array with matching elements'
  },
  {
    name: 'array-foreach',
    fixture: 'tests/fixtures/array-foreach.js',
    expectedExitCode: 10, // [1, 2, 3, 4].forEach(addToSum) results in sum = 10
    description: 'Array .forEach() should call function for each element'
  },
  {
    name: 'object-literal',
    fixture: 'tests/fixtures/object-literal.js',
    expectedExitCode: 30, // { x: 10, y: 20 } -> obj.x + obj.y = 30
    description: 'Object literal and property access should work'
  },
  {
    name: 'object-nested',
    fixture: 'tests/fixtures/object-nested.js',
    expectedExitCode: 12, // point.x (20) - point.y (8) = 12
    description: 'Object with complex property expressions should work'
  },
  {
    name: 'object-return',
    fixture: 'tests/fixtures/object-return.js',
    expectedExitCode: 42, // data.value = 42
    description: 'Returning object property should work'
  },
  {
    name: 'object-literal-access',
    fixture: 'tests/fixtures/object-literal-access.js',
    expectedExitCode: 10, // { x: 10, y: 20 }.x = 10
    description: 'Property access on object literal should work'
  },
    {
      name: 'object-method',
      fixture: 'tests/fixtures/object-method.js',
      expectedExitCode: 12, // obj.add(5, 7) = 12
      description: 'Object method call should work'
    },
    {
      name: 'class-basic',
      fixture: 'tests/fixtures/class-basic.js',
      expectedExitCode: 10, // new Counter(10).getValue() -> 10
      description: 'Class with constructor, methods, and this should work'
    },
    {
      name: 'while-loop',
      fixture: 'tests/fixtures/while-loop.js',
      expectedExitCode: 15, // 5+4+3+2+1 = 15
      description: 'While loop should sum numbers from 5 to 1'
    },
    {
      name: 'for-loop',
      fixture: 'tests/fixtures/for-loop.js',
      expectedExitCode: 55, // 1+2+3+...+10 = 55
      description: 'For loop should sum numbers from 1 to 10'
    },
    {
      name: 'map-basic',
      fixture: 'tests/fixtures/map-basic.js',
      expectedExitCode: 20, // m.get(2) -> 20
      description: 'Map with set/get operations should work'
    },
    {
      name: 'set-basic',
      fixture: 'tests/fixtures/set-basic.js',
      expectedExitCode: 1, // s.has(20) -> 1 (true)
      description: 'Set with add/has operations should work'
    }
  ];

describe('ChadScript Compiler', () => {
  describe('Compilation and Execution', { concurrency: 8 }, () => {
    for (const testCase of testCases) {
      it(testCase.description, async () => {
        const fixturePath = path.resolve(testCase.fixture);
        const outputDir = path.dirname(fixturePath);
        const baseName = path.basename(fixturePath, '.js');
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
          await execAsync(`npx tsx src/index.ts ${fixturePath}`);

          // Verify LLVM IR was generated
          assert.ok(
            fsSync.existsSync(llFile),
            `LLVM IR file should exist at ${llFile}`
          );

          // Verify executable was generated
          assert.ok(
            fsSync.existsSync(exeFile),
            `Executable should exist at ${exeFile}`
          );

          // Run the executable and check exit code
          try {
            await execAsync(exeFile);
            // If we get here, exit code was 0
            assert.strictEqual(
              0,
              testCase.expectedExitCode,
              `Expected exit code ${testCase.expectedExitCode}, got 0`
            );
          } catch (err: any) {
            // execAsync throws for non-zero exit codes
            const actualExitCode = err.code || 0;
            assert.strictEqual(
              actualExitCode,
              testCase.expectedExitCode,
              `Expected exit code ${testCase.expectedExitCode}, got ${actualExitCode}`
            );
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
      const fixturePath = path.resolve('tests/fixtures/simple-add.js');
      const outputDir = path.dirname(fixturePath);
      const baseName = path.basename(fixturePath, '.js');
      const llFile = path.join(outputDir, `${baseName}.ll`);

      // Clean up
      try {
        if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
      } catch (err) {
        // Ignore
      }

      try {
        // Compile
        await execAsync(`npx tsx src/index.ts ${fixturePath}`);

        // Read and verify LLVM IR
        const llContent = await fs.readFile(llFile, 'utf-8');

        // Check for essential LLVM IR components
        assert.ok(llContent.includes('define i32 @add'), 'Should define add function');
        assert.ok(llContent.includes('define i32 @main'), 'Should define main function');
        assert.ok(llContent.includes('ret i32'), 'Should have return statements');
        assert.ok(llContent.includes('add i32'), 'Should have add instruction');
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

  describe('Error Handling', () => {
    it('should handle missing input file', async () => {
      await assert.rejects(async () => {
        await execAsync('npx tsx src/index.ts nonexistent.js');
      }, 'Should throw error for missing file');
    });
  });
});
