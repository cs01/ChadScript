function testEmptyArrayOps(): void {
  const nums: number[] = [];
  const popped = nums.pop();
  if (popped !== 0) process.exit(1);
  if (nums.length !== 0) process.exit(1);
  const idx = nums.indexOf(42);
  if (idx !== -1) process.exit(1);
  const spliced = nums.splice(0, 0);
  if (spliced.length !== 0) process.exit(1);
  if (nums.length !== 0) process.exit(1);
  const inc = nums.includes(1);
  if (inc) process.exit(1);
  console.log("TEST_PASSED");
}
testEmptyArrayOps();
