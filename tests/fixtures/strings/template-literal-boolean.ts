function test(): void {
  const s1 = `val=${true}`;
  if (s1 !== "val=true") {
    console.log("FAIL literal true: " + s1);
    return;
  }
  const s2 = `val=${false}`;
  if (s2 !== "val=false") {
    console.log("FAIL literal false: " + s2);
    return;
  }
  const s3 = `cmp=${1 > 0}`;
  if (s3 !== "cmp=true") {
    console.log("FAIL comparison: " + s3);
    return;
  }
  const s4 = `neg=${1 < 0}`;
  if (s4 !== "neg=false") {
    console.log("FAIL false comparison: " + s4);
    return;
  }
  console.log("TEST_PASSED");
}
test();
