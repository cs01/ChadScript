// @test-description: template literals with method calls and arithmetic

function greet(name: string): string {
  return `hello ${name}`;
}

const arr = [1, 2, 3];
const nums = `sum: ${1 + 2 + 3}`;
const method = `joined: ${arr.join(",")}`;
const nested = `greeting: ${greet("world")}`;
const multi = `${arr.length} items: ${arr.join(" ")}`;

if (nums !== "sum: 6") {
  console.log("FAIL: nums = " + nums);
  process.exit(1);
}
if (method !== "joined: 1,2,3") {
  console.log("FAIL: method = " + method);
  process.exit(1);
}
if (nested !== "greeting: hello world") {
  console.log("FAIL: nested = " + nested);
  process.exit(1);
}
if (multi !== "3 items: 1 2 3") {
  console.log("FAIL: multi = " + multi);
  process.exit(1);
}

console.log("TEST_PASSED");
