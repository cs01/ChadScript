function test(): void {
  const nums: number[] = [10, 20, 30, 40, 50];

  const a = nums.at(0);
  if (a !== 10) {
    console.log("FAIL at(0)");
    return;
  }

  const b = nums.at(4);
  if (b !== 50) {
    console.log("FAIL at(4)");
    return;
  }

  const c = nums.at(-1);
  if (c !== 50) {
    console.log("FAIL at(-1)");
    return;
  }

  const d = nums.at(-5);
  if (d !== 10) {
    console.log("FAIL at(-5)");
    return;
  }

  const strs: string[] = ["a", "b", "c"];

  const e = strs.at(0);
  if (e !== "a") {
    console.log("FAIL str at(0): " + e);
    return;
  }

  const f = strs.at(-1);
  if (f !== "c") {
    console.log("FAIL str at(-1): " + f);
    return;
  }

  const g = strs.at(3);
  if (g !== "") {
    console.log("FAIL str at(3) oob");
    return;
  }

  console.log("TEST_PASSED");
}
test();
