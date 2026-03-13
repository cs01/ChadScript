const m = new Map<string, string>();
m.set("a", "hello");
const result = m.get("nonexistent");
const val = m.get("a");
if (val !== "hello") {
  process.exit(1);
}
m.set("b", "world");
if (m.size !== 2) {
  process.exit(1);
}
console.log("TEST_PASSED");
