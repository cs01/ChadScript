describe("math", () => {
  test("addition", () => {
    assert.strictEqual(1 + 1, 2);
  });
  test("subtraction", () => {
    assert.strictEqual(5 - 3, 2);
  });
});

describe("strings", () => {
  test("concat", () => {
    const s: string = "hello " + "world";
    assert.strictEqual(s, "hello world");
  });
});

console.log("TEST_PASSED");
