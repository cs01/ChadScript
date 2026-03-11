// @test-description: global scope map operations work correctly
const m = new Map<string, string>();
m.set("hello", "world");
m.set("foo", "bar");

if (m.get("hello") === "world" && m.get("foo") === "bar" && m.size === 2) {
  console.log("TEST_PASSED");
}
