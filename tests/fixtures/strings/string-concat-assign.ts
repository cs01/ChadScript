let s = "";
let i = 0;
while (i < 50) {
  s += "x";
  i = i + 1;
}
if (s.length === 50) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: expected length 50, got " + s.length.toString());
}
