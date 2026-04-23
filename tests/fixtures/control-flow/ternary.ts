// @test-exit-code: 15
function test(a: number, b: number, c: number) {
  // Basic ternary operator
  let result = a === b ? 10 : 0;

  // Add another ternary
  result = result + (a !== c ? 5 : 0);

  return result;
}

process.exit(test(5, 5, 10));
