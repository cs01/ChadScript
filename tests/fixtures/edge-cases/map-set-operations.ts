const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);

if (m.size !== 3) {
  process.exit(1);
}

if (m.get("b") !== 2) {
  process.exit(1);
}

if (!m.has("a")) {
  process.exit(1);
}

m.delete("b");
if (m.size !== 2) {
  process.exit(1);
}
if (m.has("b")) {
  process.exit(1);
}

m.set("a", 10);
if (m.get("a") !== 10) {
  process.exit(1);
}

const s = new Set<string>();
s.add("x");
s.add("y");
s.add("z");
s.add("x");

if (s.size !== 3) {
  process.exit(1);
}

if (!s.has("y")) {
  process.exit(1);
}

s.delete("y");
if (s.size !== 2) {
  process.exit(1);
}
if (s.has("y")) {
  process.exit(1);
}

console.log("TEST_PASSED");
