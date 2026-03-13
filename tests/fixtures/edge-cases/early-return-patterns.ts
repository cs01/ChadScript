function findFirst(arr: number[], target: number): number {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) return i;
  }
  return -1;
}

if (findFirst([5, 10, 15, 20], 15) !== 2) process.exit(1);
if (findFirst([5, 10, 15, 20], 99) !== -1) process.exit(1);
if (findFirst([5, 10, 15, 20], 5) !== 0) process.exit(1);

function isPositive(n: number): boolean {
  if (n > 0) return true;
  return false;
}

if (!isPositive(1)) process.exit(1);
if (isPositive(-1)) process.exit(1);
if (isPositive(0)) process.exit(1);

function clamp(val: number, lo: number, hi: number): number {
  if (val < lo) return lo;
  if (val > hi) return hi;
  return val;
}

if (clamp(5, 0, 10) !== 5) process.exit(1);
if (clamp(-5, 0, 10) !== 0) process.exit(1);
if (clamp(15, 0, 10) !== 10) process.exit(1);

console.log("TEST_PASSED");
