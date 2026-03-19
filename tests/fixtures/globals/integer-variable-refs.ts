// Tests that integer inference propagates through variable references
// e.g. m = p * p where p is already an integer candidate
const BASE = 7;
const SQUARED = BASE * BASE;
let accumulator = 0;

let i = 0;
while (i < 10) {
  accumulator = accumulator + SQUARED;
  i = i + 1;
}

if (accumulator === 490) {
  console.log("variable ref inference works");
} else {
  console.log("FAIL: expected 490 got " + accumulator);
  process.exit(1);
}

const a = 3;
const b = a + 1;
const c = a * b;
if (c === 12) {
  console.log("chained inference works");
} else {
  console.log("FAIL: expected 12 got " + c);
  process.exit(1);
}

console.log("TEST_PASSED");
