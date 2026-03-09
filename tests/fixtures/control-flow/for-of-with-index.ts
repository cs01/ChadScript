let passed = true;

const items: string[] = ["a", "b", "c", "d"];
let idx = 0;
let result = "";
for (const item of items) {
  result = result + idx + ":" + item + " ";
  idx = idx + 1;
}
if (result !== "0:a 1:b 2:c 3:d ") {
  console.log("FAIL: expected '0:a 1:b 2:c 3:d ' got '" + result + "'");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
