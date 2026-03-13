const x = "hello world".split(" ").join("-");
let passed = true;

if (x !== "hello-world") {
  passed = false;
}

const y = "a,b,c".split(",").join(" | ");
if (y !== "a | b | c") {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
