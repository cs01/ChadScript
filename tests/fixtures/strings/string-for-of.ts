const str = "abc";
let result = "";
for (const ch of str) {
  result = result + ch;
}
if (result !== "abc") {
  console.log("FAIL: expected abc, got " + result);
  process.exit(1);
}

const greeting = "hi";
let codes = 0;
for (const c of greeting) {
  codes = codes + c.charCodeAt(0);
}
if (codes !== 209) {
  console.log("FAIL: expected 209, got " + codes);
  process.exit(1);
}

console.log("TEST_PASSED");
