// @test-description: json stringify handles booleans and numbers correctly

const a = JSON.stringify(true);
const b = JSON.stringify(false);
const d = JSON.stringify(42);
const e = JSON.stringify(3.14);

if (a !== "true") {
  console.log("FAIL: true got " + a);
  process.exit(1);
}
if (b !== "false") {
  console.log("FAIL: false got " + b);
  process.exit(1);
}
if (d !== "42") {
  console.log("FAIL: 42 got " + d);
  process.exit(1);
}
if (e !== "3.14") {
  console.log("FAIL: 3.14 got " + e);
  process.exit(1);
}

const flag = true;
const flagStr = JSON.stringify(flag);
if (flagStr !== "true") {
  console.log("FAIL: var true got " + flagStr);
  process.exit(1);
}

console.log("TEST_PASSED");
