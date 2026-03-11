// @test-compile-error: for...of on Map<number, *> is not supported
// @test-description: compile error for iterating numeric map entries
function testNumericMapEntries() {
  const m = new Map<number, number>();
  m.set(1, 10);
  for (const [k, v] of m) {
    console.log(k);
  }
}

testNumericMapEntries();
