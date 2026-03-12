function add(acc: number, val: number): number {
  return acc + val;
}

function sub(acc: number, val: number): number {
  return acc - val;
}

function concat(acc: string, val: string): string {
  return acc + val;
}

function testReduceRight(): void {
  const nums: number[] = [1, 2, 3, 4, 5];

  const sum = nums.reduceRight(add, 0);
  if (sum !== 15) {
    console.log("FAIL: sum expected 15 got " + sum);
    process.exit(1);
  }

  const noInit = nums.reduceRight(add);
  if (noInit !== 15) {
    console.log("FAIL: noInit expected 15 got " + noInit);
    process.exit(1);
  }

  const nums2: number[] = [1, 2, 3, 4];
  const rightFold = nums2.reduceRight(sub);
  if (rightFold !== -2) {
    console.log("FAIL: rightFold expected -2 got " + rightFold);
    process.exit(1);
  }

  const strs: string[] = ["a", "b", "c"];

  const joined = strs.reduceRight(concat, "");
  if (joined !== "cba") {
    console.log("FAIL: joined expected 'cba' got '" + joined + "'");
    process.exit(1);
  }

  const strNoInit = strs.reduceRight(concat);
  if (strNoInit !== "cba") {
    console.log("FAIL: strNoInit expected 'cba' got '" + strNoInit + "'");
    process.exit(1);
  }

  const single: number[] = [42];
  const singleResult = single.reduceRight(add);
  if (singleResult !== 42) {
    console.log("FAIL: singleResult expected 42 got " + singleResult);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testReduceRight();
