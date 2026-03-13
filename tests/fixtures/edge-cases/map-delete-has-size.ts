const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);

if (!m.has("b")) process.exit(1);
const val = m.get("b");
if (val !== 2) process.exit(1);
m.delete("b");
if (m.has("b")) process.exit(1);
if (m.size !== 2) process.exit(1);

console.log("TEST_PASSED");
