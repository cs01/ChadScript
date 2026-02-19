const s = new Set<number>();
s.add(1);
s.add(2);
s.add(3);
s.add(4);
s.add(5);
s.add(6);
s.add(7);
s.add(8);
s.add(9);
s.add(10);

if (s.size !== 10) {
  console.log("FAIL: expected size 10, got " + s.size.toString());
  process.exit(1);
}

s.add(5);
s.add(10);
if (s.size !== 10) {
  console.log("FAIL: dedup failed, expected size 10, got " + s.size.toString());
  process.exit(1);
}

if (!s.has(1)) {
  console.log("FAIL: missing 1");
  process.exit(1);
}
if (!s.has(5)) {
  console.log("FAIL: missing 5");
  process.exit(1);
}
if (!s.has(10)) {
  console.log("FAIL: missing 10");
  process.exit(1);
}
if (s.has(11)) {
  console.log("FAIL: found 11 which was never added");
  process.exit(1);
}

console.log("TEST_PASSED");
