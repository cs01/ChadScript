// @test-description: for...of iterates over string characters
function test() {
  const s = "hello";
  let result = "";
  for (const ch of s) {
    result = result + ch;
  }
  if (result !== "hello") {
    console.log("FAIL: concat = " + result);
    return;
  }

  let count = 0;
  for (const c of "abc") {
    count = count + 1;
  }
  if (count !== 3) {
    console.log("FAIL: count = " + count);
    return;
  }

  let first = "";
  for (const ch of "xyz") {
    first = ch;
    break;
  }
  if (first !== "x") {
    console.log("FAIL: first = " + first);
    return;
  }

  console.log("TEST_PASSED");
}
test();
