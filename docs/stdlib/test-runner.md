# Test Runner

Built-in test runner with `test()` and `assert.*` — no imports needed.

## `test()`

Define a test case with a name and callback.

```typescript
test("addition works", () => {
  assert.strictEqual(2 + 2, 4);
});

test("strings match", () => {
  const s: string = "hello";
  assert.strictEqual(s, "hello");
});
```

Output:

```
  PASS: addition works
  PASS: strings match

2 passed, 0 failed (2 total)
```

The process exits with code 1 if any test fails, 0 if all pass.

## `assert.strictEqual()`

Check that two values are equal. Works with numbers and strings.

```typescript
assert.strictEqual(1 + 1, 2);
assert.strictEqual("foo", "foo");
```

On failure, prints `expected <expected>, got <actual>` to stderr.

## `assert.notStrictEqual()`

Check that two values are not equal.

```typescript
assert.notStrictEqual(1, 2);
assert.notStrictEqual("a", "b");
```

## `assert.ok()`

Check that a value is truthy. Numbers must be non-zero, strings must be non-null and non-empty.

```typescript
assert.ok(42);
assert.ok("non-empty");
```

## `assert.fail()`

Unconditionally fail the current test, with an optional message.

```typescript
assert.fail("not implemented yet");
```

## `assert.deepEqual()`

Compare two arrays element-by-element. Works with `number[]` and `string[]`.

```typescript
const a: number[] = [1, 2, 3];
const b: number[] = [1, 2, 3];
assert.deepEqual(a, b);

const x: string[] = ["hello", "world"];
const y: string[] = ["hello", "world"];
assert.deepEqual(x, y);
```

On failure, prints either `expected length <n>, got length <m>` or `arrays differ at index <i>` to stderr.

## `describe()`

Group related tests with a label. Nesting is supported and indentation is applied automatically.

```typescript
describe("math", () => {
  test("addition", () => {
    assert.strictEqual(1 + 1, 2);
  });
  test("subtraction", () => {
    assert.strictEqual(5 - 3, 2);
  });
});
```

Output:

```
math
    PASS: addition
    PASS: subtraction

2 passed, 0 failed (2 total) 0ms
```
