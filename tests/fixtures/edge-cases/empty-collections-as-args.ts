// @test-description: empty arrays maps and sets passed as function arguments

function sumArray(arr: number[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total = total + arr[i];
  }
  return total;
}

function countStrings(arr: string[]): number {
  return arr.length;
}

function countSet(s: Set<number>): number {
  return s.size;
}

if (sumArray([]) !== 0) {
  console.log("FAIL: sum of empty should be 0");
  process.exit(1);
}
if (countStrings([]) !== 0) {
  console.log("FAIL: count of empty strings should be 0");
  process.exit(1);
}

const emptyNums: number[] = [];
if (sumArray(emptyNums) !== 0) {
  console.log("FAIL: sum of empty var should be 0");
  process.exit(1);
}

const emptySet = new Set<number>();
if (countSet(emptySet) !== 0) {
  console.log("FAIL: empty set size should be 0");
  process.exit(1);
}

if (sumArray([10, 20, 30]) !== 60) {
  console.log("FAIL: sum should be 60");
  process.exit(1);
}

function mapSize(m: Map<string, string>): number {
  return m.size;
}

const m = new Map<string, string>();
if (mapSize(m) !== 0) {
  console.log("FAIL: empty map size should be 0");
  process.exit(1);
}
m.set("key", "val");
if (mapSize(m) !== 1) {
  console.log("FAIL: map size should be 1");
  process.exit(1);
}

console.log("TEST_PASSED");
