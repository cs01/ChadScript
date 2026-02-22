// @test-exit-code: 1
test("passing test", () => {
  assert.strictEqual(1, 1);
});

test("failing equality", () => {
  assert.strictEqual(1, 2);
});

test("another pass", () => {
  assert.ok(42);
});
