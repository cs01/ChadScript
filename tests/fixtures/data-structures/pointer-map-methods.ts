interface Item {
  name: string;
  value: number;
}

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

if (!map.has(a)) {
  console.log("FAIL: should have key a");
  process.exit(1);
}

if (!map.has(b)) {
  console.log("FAIL: should have key b");
  process.exit(1);
}

const got = map.get(a);
if (got !== "first") {
  console.log("FAIL: get(a) should be first");
  process.exit(1);
}

map.delete(b);
if (map.size !== 2) {
  console.log("FAIL: size should be 2 after delete");
  process.exit(1);
}

if (map.has(b)) {
  console.log("FAIL: should not have key b after delete");
  process.exit(1);
}

if (!map.has(c)) {
  console.log("FAIL: should still have key c after deleting b");
  process.exit(1);
}

console.log("TEST_PASSED");
