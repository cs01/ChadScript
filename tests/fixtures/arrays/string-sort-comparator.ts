let passed = true;

const strs: string[] = ["cherry", "apple", "banana"];
strs.sort((a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
});
if (strs[0] !== "apple") passed = false;
if (strs[1] !== "banana") passed = false;
if (strs[2] !== "cherry") passed = false;

const desc: string[] = ["a", "c", "b"];
desc.sort((a: string, b: string): number => {
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
});
if (desc[0] !== "c") passed = false;
if (desc[1] !== "b") passed = false;
if (desc[2] !== "a") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
