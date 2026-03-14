// @test-description: map entries without destructuring emits compile error
// @test-compile-error: Map entries() requires destructured iteration

const m = new Map<string, string>();
m.set("a", "1");

for (const entry of m.entries()) {
  console.log(entry);
}
