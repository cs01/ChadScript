let passed = true;

const s: string | null = null;
if (s !== null) passed = false;
if (s === null) {
} else {
  passed = false;
}

const val: string = "hello";
if (val === null) passed = false;
if (val !== null) {
} else {
  passed = false;
}

if (null === null) {
} else {
  passed = false;
}

if (undefined === undefined) {
} else {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
