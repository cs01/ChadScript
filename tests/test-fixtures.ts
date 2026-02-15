export interface TestCase {
  name: string;
  fixture: string;
  description: string;
  expectedExitCode?: number;
  expectTestPassed?: boolean;
  args?: string[];
}

export const testCases: TestCase[] = [
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
    args: ['testarg']
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
    name: 'console-log-array',
    fixture: 'tests/fixtures/builtins/console-log-array.ts',
    expectTestPassed: true,
    description: 'console.log should print arrays correctly'
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
    name: 'regex-exec',
    fixture: 'tests/fixtures/regex/regex-exec.ts',
    expectTestPassed: true,
    description: 'RegExp.exec() with literal, variable, and new RegExp patterns'
  },
  {
    name: 'fs-readdirSync',
    fixture: 'tests/fixtures/builtins/fs-readdir.ts',
    expectTestPassed: true,
    description: 'fs.readdirSync should list directory entries'
  },
  {
    name: 'fs-statSync',
    fixture: 'tests/fixtures/builtins/fs-stat.ts',
    expectTestPassed: true,
    description: 'fs.statSync should return file/directory metadata'
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
    name: 'ws-server-basic',
    fixture: 'tests/fixtures/websocket/ws-server-basic.ts',
    expectTestPassed: true,
    description: 'WebSocket server basic compilation test'
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
    name: 'array-index-assign',
    fixture: 'tests/fixtures/arrays/array-index-assign.ts',
    expectTestPassed: true,
    description: 'Array element assignment arr[i] = value with computed indices'
  },
  {
    name: 'rest-params',
    fixture: 'tests/fixtures/functions/rest-params.ts',
    expectTestPassed: true,
    description: 'Rest parameters function(...args) with spread call syntax should work'
  },
  {
    name: 'user-main-function',
    fixture: 'tests/fixtures/functions/user-main-function.ts',
    expectTestPassed: true,
    description: 'User function named main() should not conflict with C entry point'
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
  },
  {
    name: 'crypto',
    fixture: 'tests/fixtures/builtins/crypto-test.ts',
    expectTestPassed: true,
    description: 'crypto.sha256, md5, sha512, randomBytes via OpenSSL'
  },
  {
    name: 'sqlite',
    fixture: 'tests/fixtures/builtins/sqlite-test.ts',
    expectTestPassed: true,
    description: 'sqlite.open, exec, get, all, close via libsqlite3'
  },
  {
    name: 'large-numbers',
    fixture: 'tests/fixtures/math/large-numbers.ts',
    expectTestPassed: true,
    description: 'large integer literals beyond i32 range and big arithmetic'
  },
  {
    name: 'stable-struct',
    fixture: 'tests/fixtures/interfaces/stable-struct.ts',
    expectedExitCode: 0,
    description: 'Interface struct creation, passing, and returning should work'
  },
  {
    name: 'interface-array-mutation',
    fixture: 'tests/fixtures/arrays/interface-array-mutation.ts',
    expectTestPassed: true,
    description: 'Mutating fields of interface objects in arrays (arr[i].field = value) should work'
  },
  {
    name: 'string-builder',
    fixture: 'tests/fixtures/strings/string-builder.ts',
    expectTestPassed: true,
    description: 'String builder optimization for s = s + x pattern should produce correct results'
  },
  {
    name: 'string-builder-loop',
    fixture: 'tests/fixtures/strings/string-builder-loop.ts',
    expectTestPassed: true,
    description: 'String builder with let re-declaration inside a loop should not segfault'
  }
];
