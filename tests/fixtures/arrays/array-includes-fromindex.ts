const nums: number[] = [10, 20, 30, 40, 50];

if (!nums.includes(30, 0)) {
  console.log("FAIL: includes 30 from 0");
  process.exit(1);
}

if (!nums.includes(30, 2)) {
  console.log("FAIL: includes 30 from 2");
  process.exit(1);
}

if (nums.includes(30, 3)) {
  console.log("FAIL: includes 30 from 3 should be false");
  process.exit(1);
}

if (nums.includes(10, 1)) {
  console.log("FAIL: includes 10 from 1 should be false");
  process.exit(1);
}

if (!nums.includes(50, -1)) {
  console.log("FAIL: includes 50 from -1 should search last element");
  process.exit(1);
}

if (nums.includes(10, -1)) {
  console.log("FAIL: includes 10 from -1 should not find first element");
  process.exit(1);
}

if (!nums.includes(10, -10)) {
  console.log("FAIL: includes 10 from -10 should clamp to 0");
  process.exit(1);
}

if (nums.includes(30, 100)) {
  console.log("FAIL: includes from past end should be false");
  process.exit(1);
}

const strs: string[] = ["hello", "world", "foo"];

if (!strs.includes("world", 0)) {
  console.log("FAIL: string includes world from 0");
  process.exit(1);
}

if (strs.includes("hello", 1)) {
  console.log("FAIL: string includes hello from 1 should be false");
  process.exit(1);
}

if (!strs.includes("foo", -1)) {
  console.log("FAIL: string includes foo from -1");
  process.exit(1);
}

console.log("TEST_PASSED");
