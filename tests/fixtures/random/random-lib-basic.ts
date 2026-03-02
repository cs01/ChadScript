import { Random } from "../../../lib/random.js";

const rng1 = new Random(12345);
const a = rng1.next();
const b = rng1.next();
const c = rng1.next();

if (a < 0 || a >= 1 || b < 0 || b >= 1 || c < 0 || c >= 1) {
  console.log("FAIL: values out of [0, 1) range");
  process.exit(1);
}

if (a === b && b === c) {
  console.log("FAIL: all values identical");
  process.exit(1);
}

const rng2 = new Random(12345);
const d = rng2.next();
const e = rng2.next();
const f = rng2.next();

if (a !== d || b !== e || c !== f) {
  console.log("FAIL: same seed produced different sequences");
  process.exit(1);
}

const rng3 = new Random(99999);
const g = rng3.next();
if (g === a) {
  console.log("FAIL: different seeds produced same first value");
  process.exit(1);
}

const n = rng1.nextInt(0, 10);
if (n < 0 || n >= 10) {
  console.log("FAIL: nextInt out of range");
  process.exit(1);
}

console.log("TEST_PASSED");
