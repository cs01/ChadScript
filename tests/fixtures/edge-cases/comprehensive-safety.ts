function test(): void {
  const nums: number[] = [10, 20, 30];
  nums[0] = 100;
  if (nums[0] !== 100) {
    console.log("FAIL array assign");
    return;
  }

  const strs: string[] = ["a", "b", "c"];
  strs[1] = "x";
  if (strs[1] !== "x") {
    console.log("FAIL string array assign");
    return;
  }

  const s = "hello world";
  const sub1 = s.substr(6);
  if (sub1 !== "world") {
    console.log("FAIL substr: " + sub1);
    return;
  }

  const sub2 = s.slice(-5);
  if (sub2 !== "world") {
    console.log("FAIL slice neg: " + sub2);
    return;
  }

  const r = "ab".repeat(3);
  if (r !== "ababab") {
    console.log("FAIL repeat: " + r);
    return;
  }

  const mod1 = 10 % 3;
  if (mod1 !== 1) {
    console.log("FAIL modulo: " + mod1.toString());
    return;
  }

  const x = 42;
  const y = parseInt(x.toString());
  if (y !== 42) {
    console.log("FAIL parseInt: " + y.toString());
    return;
  }

  const inf = Infinity;
  if (inf <= 0) {
    console.log("FAIL Infinity");
    return;
  }

  const nan = NaN;
  if (!isNaN(nan)) {
    console.log("FAIL NaN");
    return;
  }

  console.log("TEST_PASSED");
}
test();
