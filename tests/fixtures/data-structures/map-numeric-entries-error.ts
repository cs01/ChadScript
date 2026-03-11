// @test-compile-error: Map.entries() not yet supported for Map<number, *> types
// @test-description: compile error for entries() on numeric map
function testNumericMapEntries() {
  const m = new Map<number, number>();
  m.set(1, 10);
  const e = m.entries();
}

testNumericMapEntries();
