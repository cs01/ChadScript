function testNumericMapKeysValues() {
  const m = new Map<number, number>();
  m.set(10, 100);
  m.set(20, 200);
  m.set(30, 300);

  const keys = m.keys();
  if (keys.length !== 3) {
    console.log("FAIL: keys length should be 3");
    process.exit(1);
  }

  let keySum = 0;
  let i = 0;
  while (i < keys.length) {
    keySum = keySum + keys[i];
    i = i + 1;
  }
  if (keySum !== 60) {
    console.log("FAIL: key sum should be 60");
    process.exit(1);
  }

  const vals = m.values();
  if (vals.length !== 3) {
    console.log("FAIL: values length should be 3");
    process.exit(1);
  }

  let valSum = 0;
  let j = 0;
  while (j < vals.length) {
    valSum = valSum + vals[j];
    j = j + 1;
  }
  if (valSum !== 600) {
    console.log("FAIL: value sum should be 600");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNumericMapKeysValues();
