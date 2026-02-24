// @test-description: type assertion with reordered fields
// Verifies that `as { ... }` with fields in different order than the
// object literal doesn't cause wrong field access or segfault.
function testAssertOrder(): void {
  const obj = { name: "alice", age: 30 };
  const typed = obj as { age: number; name: string };
  if (typed.age === 30 && typed.name === "alice") {
    console.log("TEST_PASSED");
  }
}
testAssertOrder();
