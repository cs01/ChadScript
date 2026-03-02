Math.seedRandom(42);
const a1 = Math.random();
const a2 = Math.random();

Math.seedRandom(42);
const b1 = Math.random();
const b2 = Math.random();

if (a1 !== b1 || a2 !== b2) {
  console.log("FAIL: same seed produced different sequences");
  process.exit(1);
}

Math.seedRandom(99);
const c1 = Math.random();

if (c1 === a1) {
  console.log("FAIL: different seeds produced same first value");
  process.exit(1);
}

if (a1 < 0 || a1 >= 1 || b1 < 0 || b1 >= 1) {
  console.log("FAIL: values out of [0, 1) range");
  process.exit(1);
}

console.log("TEST_PASSED");
