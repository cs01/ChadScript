const a = true;
const b = false;
const c = [1, 2, 3].includes(2);
const d = [1, 2, 3].some((n: number) => n > 2);
const e = "hello".startsWith("h");
const f = "hello".includes("ell");
let output = "";
output = output + a + "," + b + "," + c + "," + d + "," + e + "," + f;
if (a === true && b === false && c === true && d === true && e === true && f === true) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + output);
}
