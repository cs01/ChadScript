const chars = "abc".split("");
if (chars.length !== 3) {
  process.exit(1);
}
if (chars[0] !== "a" || chars[1] !== "b" || chars[2] !== "c") {
  process.exit(1);
}
const single = "x".split("");
if (single.length !== 1 || single[0] !== "x") {
  process.exit(1);
}
console.log("TEST_PASSED");
