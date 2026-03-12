let passed = true;

const arr = [10, 20, 30, 40, 50];
if (arr.indexOf(30, -3) !== 2) passed = false;
if (arr.indexOf(10, -5) !== 0) passed = false;
if (arr.indexOf(50, -1) !== 4) passed = false;
if (arr.indexOf(10, -1) !== -1) passed = false;
if (arr.indexOf(30, -100) !== 2) passed = false;
if (arr.indexOf(30, 0) !== 2) passed = false;
if (arr.indexOf(30, 3) !== -1) passed = false;

const strs = ["a", "b", "c", "d"];
if (strs.indexOf("c", -2) !== 2) passed = false;
if (strs.indexOf("a", -1) !== -1) passed = false;
if (strs.indexOf("d", -1) !== 3) passed = false;
if (strs.indexOf("a", -100) !== 0) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
