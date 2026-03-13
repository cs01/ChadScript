function testDrainAndRefill(): void {
  const arr: number[] = [10, 20, 30];
  const a = arr.pop();
  if (a !== 30) process.exit(1);
  const b = arr.pop();
  if (b !== 20) process.exit(1);
  const c = arr.pop();
  if (c !== 10) process.exit(1);
  if (arr.length !== 0) process.exit(1);
  const d = arr.pop();
  if (d !== 0) process.exit(1);
  if (arr.length !== 0) process.exit(1);
  arr.push(100);
  arr.push(200);
  if (arr.length !== 2) process.exit(1);
  if (arr[0] !== 100) process.exit(1);
  if (arr[1] !== 200) process.exit(1);
  console.log("TEST_PASSED");
}
testDrainAndRefill();
