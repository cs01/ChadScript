let passed = true;

const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let evenSum = 0;
for (const n of nums) {
  if (n % 2 !== 0) {
    continue;
  }
  evenSum = evenSum + n;
}
if (evenSum !== 30) {
  console.log("FAIL: evenSum expected 30 got " + evenSum);
  passed = false;
}

const words: string[] = ["hello", "", "world", "", "test"];
let nonEmpty = "";
for (const w of words) {
  if (w === "") {
    continue;
  }
  nonEmpty = nonEmpty + w + " ";
}
if (nonEmpty !== "hello world test ") {
  console.log("FAIL: nonEmpty expected 'hello world test ' got '" + nonEmpty + "'");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
