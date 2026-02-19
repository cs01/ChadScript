const s = new Set<string>();
s.add("alpha");
s.add("bravo");
s.add("charlie");
s.add("delta");
s.add("echo");
s.add("foxtrot");
s.add("golf");
s.add("hotel");

if (s.size !== 8) {
  console.log("FAIL: expected size 8, got " + s.size.toString());
  process.exit(1);
}

s.add("alpha");
s.add("echo");
if (s.size !== 8) {
  console.log("FAIL: dedup failed, expected size 8, got " + s.size.toString());
  process.exit(1);
}

if (!s.has("alpha")) {
  console.log("FAIL: missing alpha");
  process.exit(1);
}
if (!s.has("hotel")) {
  console.log("FAIL: missing hotel");
  process.exit(1);
}
if (s.has("india")) {
  console.log("FAIL: found india which was never added");
  process.exit(1);
}

console.log("TEST_PASSED");
