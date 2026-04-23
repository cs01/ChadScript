// @test-exit-code: 15
function test(a: number, b: number, c: number) {
  let result = 0;

  // Test === (strict equality)
  if (a === b) {
    result = result + 10; // Should add 10
  }

  if (a === c) {
    result = result + 100; // Should NOT add
  }

  // Test !== (strict inequality)
  if (a !== c) {
    result = result + 5; // Should add 5
  }

  if (a !== b) {
    result = result + 100; // Should NOT add
  }

  return result; // Should return 15 (10 + 5)
}

process.exit(test(5, 5, 10));
