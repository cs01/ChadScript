const n = [1, 2, 3, 4, 5].filter((x: number): boolean => x > 3).length;
let passed = true;

if (n !== 2) {
  passed = false;
}

const words = ["hello", "world", "hi"].filter((s: string): boolean => s.length > 2).length;
if (words !== 2) {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
