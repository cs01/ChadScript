let passed = true;

let x = 5;
const a = x++;
if (a !== 5) passed = false;
if (x !== 6) passed = false;

let y = 10;
const b = ++y;
if (b !== 11) passed = false;
if (y !== 11) passed = false;

let z = 3;
const c = z--;
if (c !== 3) passed = false;
if (z !== 2) passed = false;

let w = 7;
const d = --w;
if (d !== 6) passed = false;
if (w !== 6) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
