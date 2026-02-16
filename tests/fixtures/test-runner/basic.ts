test("addition works", () => {
  assert.strictEqual(2 + 2, 4);
});

test("string comparison", () => {
  const greeting: string = "hello";
  assert.strictEqual(greeting, "hello");
});

test("assert.ok truthy", () => {
  assert.ok(1);
  assert.ok("non-empty");
});

test("assert.notStrictEqual", () => {
  assert.notStrictEqual(1, 2);
  assert.notStrictEqual("a", "b");
});

console.log("TEST_PASSED");
