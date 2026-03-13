const nums: number[] = [5, 3, 8, 1, 9, 2, 7];

const sorted = nums.slice(0, nums.length);
sorted.sort((a: number, b: number) => a - b);
if (sorted[0] !== 1) {
  process.exit(1);
}
if (sorted[6] !== 9) {
  process.exit(1);
}

const evens = nums.filter((n: number) => n % 2 === 0);
if (evens.length !== 2) {
  process.exit(1);
}

const sum = nums.reduce((acc: number, n: number) => acc + n, 0);
if (sum !== 35) {
  process.exit(1);
}

const doubled = nums.map((n: number) => n * 2);
if (doubled[0] !== 10) {
  process.exit(1);
}
if (doubled.length !== 7) {
  process.exit(1);
}

const hasNeg = nums.some((n: number) => n < 0);
if (hasNeg) {
  process.exit(1);
}

const allPos = nums.every((n: number) => n > 0);
if (!allPos) {
  process.exit(1);
}

const big = nums.find((n: number) => n > 7);
if (big !== 8) {
  process.exit(1);
}

const bigIdx = nums.findIndex((n: number) => n > 7);
if (bigIdx !== 2) {
  process.exit(1);
}

if (nums.includes(5) !== true) {
  process.exit(1);
}
if (nums.includes(99) !== false) {
  process.exit(1);
}

console.log("TEST_PASSED");
