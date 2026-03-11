function test(): void {
  const n: string | null = null;
  const s1 = "val: " + n;
  if (s1 !== "val: null") {
    console.log("FAIL null: " + s1);
    return;
  }
  const s2 = "hi " + "world";
  if (s2 !== "hi world") {
    console.log("FAIL normal: " + s2);
    return;
  }
  const x: string | null = "hello";
  const s3 = "val: " + x;
  if (s3 !== "val: hello") {
    console.log("FAIL non-null: " + s3);
    return;
  }
  console.log("TEST_PASSED");
}
test();
