const m = new Map<number, number>();
m.set(0, 42);
const v = m.get(0);
if (v !== 42) {
  process.exit(1);
}
m.set(1, 100);
m.set(2, 200);
m.delete(1);
if (m.has(1)) {
  process.exit(1);
}
const v2 = m.get(2);
if (v2 !== 200) {
  process.exit(1);
}
if (m.size !== 2) {
  process.exit(1);
}
console.log("TEST_PASSED");
