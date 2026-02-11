const num = 42;
const str = "hello";
const flag = true;

if (typeof num !== "number") {
  console.log("FAIL: typeof num should be number");
  process.exit(1);
}

if (typeof str !== "string") {
  console.log("FAIL: typeof str should be string");
  process.exit(1);
}

if (typeof "literal" !== "string") {
  console.log("FAIL: typeof literal should be string");
  process.exit(1);
}

if (typeof 42 !== "number") {
  console.log("FAIL: typeof 42 should be number");
  process.exit(1);
}

console.log(typeof num);
console.log(typeof str);

console.log("TEST_PASSED");
