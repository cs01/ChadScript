let passed = true;

const arr1 = [1, 2, 3, 4, 5];
arr1.splice(1, -1);
if (arr1.length !== 5) passed = false;

const arr2 = [10, 20, 30];
arr2.splice(0, 2);
if (arr2.length !== 1) passed = false;
if (arr2[0] !== 30) passed = false;

const arr3 = [1, 2, 3];
arr3.splice(1, 0);
if (arr3.length !== 3) passed = false;

const arr4 = [1, 2, 3, 4];
arr4.splice(-2, 1);
if (arr4.length !== 3) passed = false;
if (arr4[0] !== 1) passed = false;
if (arr4[1] !== 2) passed = false;
if (arr4[2] !== 4) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
