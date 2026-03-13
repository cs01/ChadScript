function testPushReturnValue(): void {
  const nums: number[] = [];
  const len1 = nums.push(10);
  const len2 = nums.push(20);
  const len3 = nums.push(30);
  if (len1 !== 1) process.exit(1);
  if (len2 !== 2) process.exit(1);
  if (len3 !== 3) process.exit(1);
  const total = len1 + len2 + len3;
  if (total !== 6) process.exit(1);
  const strs: string[] = [];
  const slen = strs.push("hello");
  if (slen !== 1) process.exit(1);
  console.log("TEST_PASSED");
}
testPushReturnValue();
