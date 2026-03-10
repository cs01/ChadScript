function test() {
  const m = new Map<string, number>();
  m.set("x", 42);
  m.set("y", 100);
  m.set("z", 0.5);
  const v: number = m.get("x");
  const v2: number = m.get("y");
  const v3: number = m.get("z");
  const sum = v + v2;
  if (sum !== 142) {
    console.log("FAIL: expected 142, got " + sum);
    return;
  }
  if (v3 !== 0.5) {
    console.log("FAIL: expected 0.5, got " + v3);
    return;
  }
  console.log("TEST_PASSED");
}
test();
