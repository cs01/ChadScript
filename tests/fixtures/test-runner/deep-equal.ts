test("number arrays equal", () => {
  const a: number[] = [1, 2, 3];
  const b: number[] = [1, 2, 3];
  assert.deepEqual(a, b);
});

test("string arrays equal", () => {
  const a: string[] = ["hello", "world"];
  const b: string[] = ["hello", "world"];
  assert.deepEqual(a, b);
});

test("empty arrays equal", () => {
  const a: number[] = [];
  const b: number[] = [];
  assert.deepEqual(a, b);
});

console.log("TEST_PASSED");
