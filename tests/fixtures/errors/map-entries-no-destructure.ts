// @test-description: map entries without destructuring emits compile error
// @test-compile-error: Map entries() requires destructured iteration
// @test-native-skip: native throws internal "array index -1 out of bounds" instead of the Map.entries() destructure diagnostic (missing native semantic check)

const m = new Map<string, string>();
m.set("a", "1");

for (const entry of m.entries()) {
  console.log(entry);
}
