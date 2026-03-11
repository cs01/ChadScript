interface Item {
  name: string;
  value: number;
}

function testPointerMapClearAndReset() {
  const map: Map<Item, string> = new Map();
  const a: Item = { name: "alpha", value: 1 };
  const b: Item = { name: "beta", value: 2 };
  const c: Item = { name: "gamma", value: 3 };

  map.set(a, "first");
  map.set(b, "second");
  map.set(c, "third");

  if (map.size !== 3) {
    console.log("FAIL: size should be 3");
    process.exit(1);
  }

  map.clear();
  if (map.size !== 0) {
    console.log("FAIL: size should be 0 after clear");
    process.exit(1);
  }

  if (map.has(a)) {
    console.log("FAIL: should not have key a after clear");
    process.exit(1);
  }

  map.set(a, "restored");
  if (map.size !== 1) {
    console.log("FAIL: size should be 1 after re-add");
    process.exit(1);
  }

  const val = map.get(a);
  if (val !== "restored") {
    console.log("FAIL: get(a) should be 'restored'");
    process.exit(1);
  }

  map.set(b, "also-restored");
  map.set(c, "and-this");
  if (map.size !== 3) {
    console.log("FAIL: size should be 3 after re-adding all");
    process.exit(1);
  }

  map.delete(a);
  map.delete(b);
  map.delete(c);
  if (map.size !== 0) {
    console.log("FAIL: size should be 0 after deleting all");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testPointerMapClearAndReset();
