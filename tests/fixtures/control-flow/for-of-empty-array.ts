let passed = true;

const empty: number[] = [];
let count = 0;
for (const n of empty) {
  count = count + 1;
}
if (count !== 0) {
  console.log("FAIL: count expected 0 got " + count);
  passed = false;
}

const emptyStrings: string[] = [];
let strCount = 0;
for (const s of emptyStrings) {
  strCount = strCount + 1;
}
if (strCount !== 0) {
  console.log("FAIL: strCount expected 0 got " + strCount);
  passed = false;
}

interface Item {
  name: string;
}
const emptyItems: Item[] = [];
let itemCount = 0;
for (const item of emptyItems) {
  itemCount = itemCount + 1;
}
if (itemCount !== 0) {
  console.log("FAIL: itemCount expected 0 got " + itemCount);
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
