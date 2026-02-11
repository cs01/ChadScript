function testArrayIsArray(): void {
  const nums: number[] = [1, 2, 3];
  const strs: string[] = ["a", "b"];
  const n: number = 42;
  const s: string = "hello";

  if (!Array.isArray(nums)) {
    console.log("Error: number[] should be an array");
    process.exit(1);
  }

  if (!Array.isArray(strs)) {
    console.log("Error: string[] should be an array");
    process.exit(1);
  }

  if (Array.isArray(n)) {
    console.log("Error: number should not be an array");
    process.exit(1);
  }

  if (Array.isArray(s)) {
    console.log("Error: string should not be an array");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArrayIsArray();
