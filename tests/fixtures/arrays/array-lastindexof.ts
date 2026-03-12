const nums: number[] = [10, 20, 30, 20, 10];

if (nums.lastIndexOf(10) !== 4) {
  console.log("FAIL: lastIndexOf 10 should be 4, got " + nums.lastIndexOf(10));
  process.exit(1);
}

if (nums.lastIndexOf(20) !== 3) {
  console.log("FAIL: lastIndexOf 20 should be 3");
  process.exit(1);
}

if (nums.lastIndexOf(30) !== 2) {
  console.log("FAIL: lastIndexOf 30 should be 2");
  process.exit(1);
}

if (nums.lastIndexOf(99) !== -1) {
  console.log("FAIL: lastIndexOf 99 should be -1");
  process.exit(1);
}

if (nums.lastIndexOf(20, 2) !== 1) {
  console.log("FAIL: lastIndexOf 20 from 2 should be 1");
  process.exit(1);
}

if (nums.lastIndexOf(10, 0) !== 0) {
  console.log("FAIL: lastIndexOf 10 from 0 should be 0");
  process.exit(1);
}

if (nums.lastIndexOf(10, -2) !== 0) {
  console.log("FAIL: lastIndexOf 10 from -2 should be 0");
  process.exit(1);
}

if (nums.lastIndexOf(10, -1) !== 4) {
  console.log("FAIL: lastIndexOf 10 from -1 should be 4");
  process.exit(1);
}

const strs: string[] = ["a", "b", "c", "b", "a"];

if (strs.lastIndexOf("b") !== 3) {
  console.log("FAIL: string lastIndexOf b should be 3");
  process.exit(1);
}

if (strs.lastIndexOf("b", 2) !== 1) {
  console.log("FAIL: string lastIndexOf b from 2 should be 1");
  process.exit(1);
}

if (strs.lastIndexOf("z") !== -1) {
  console.log("FAIL: string lastIndexOf z should be -1");
  process.exit(1);
}

console.log("TEST_PASSED");
