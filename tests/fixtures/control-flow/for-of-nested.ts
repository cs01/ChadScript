let passed = true;

const matrix: number[][] = [[1, 2], [3, 4], [5, 6]];
let total = 0;
for (const row of matrix) {
  for (const val of row) {
    total = total + val;
  }
}
if (total !== 21) {
  console.log("FAIL: total expected 21 got " + total);
  passed = false;
}

const words: string[][] = [["hello", "world"], ["foo", "bar"]];
let allWords = "";
for (const group of words) {
  for (const word of group) {
    allWords = allWords + word + " ";
  }
}
if (allWords !== "hello world foo bar ") {
  console.log("FAIL: allWords expected 'hello world foo bar ' got '" + allWords + "'");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
