let s = "";
let i = 0;
while (i < 10000) {
  s = s + "x";
  i = i + 1;
}
if (s.length === 10000) {
  console.log("TEST_PASSED");
}
