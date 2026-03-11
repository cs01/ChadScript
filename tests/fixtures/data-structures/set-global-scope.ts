// @test-description: global scope set operations work correctly
const s = new Set<string>();
s.add("hello");
s.add("world");
s.add("hello");

if (s.has("hello") && s.has("world") && s.size === 2) {
  console.log("TEST_PASSED");
}
