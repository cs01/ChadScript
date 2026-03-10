function testMapValues() {
  const m = new Map<string, string>();
  m.set("x", "alpha");
  m.set("y", "beta");

  const vals = m.values();
  let count = 0;
  for (const v of vals) {
    count = count + 1;
  }

  if (count !== 2) {
    console.log("FAIL: expected 2 values, got " + count);
    return;
  }

  console.log("TEST_PASSED");
}

testMapValues();
