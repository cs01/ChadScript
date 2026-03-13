function makeMap(): Map<string, string> {
  const m = new Map<string, string>();
  m.set("a", "1");
  m.set("b", "2");
  return m;
}

const m = makeMap();
let passed = true;

if (m.size !== 2) {
  passed = false;
}
if (m.get("a") !== "1") {
  passed = false;
}
if (m.get("b") !== "2") {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
