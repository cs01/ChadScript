const m = new Map<string, string>();
m.set("a", "1");
m.set("b", "2");
m.set("c", "3");
const entries = m.entries();
if (entries.length !== 3) {
  process.exit(1);
}
console.log("TEST_PASSED");
