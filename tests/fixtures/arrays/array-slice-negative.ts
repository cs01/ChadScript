const nums: number[] = [10, 20, 30, 40, 50];
const last2 = nums.slice(-2);
const allButLast = nums.slice(0, -1);
const middle = nums.slice(1, -1);

let passed = true;

if (last2.length !== 2) passed = false;
if (last2[0] !== 40) passed = false;
if (last2[1] !== 50) passed = false;

if (allButLast.length !== 4) passed = false;
if (allButLast[0] !== 10) passed = false;
if (allButLast[3] !== 40) passed = false;

if (middle.length !== 3) passed = false;
if (middle[0] !== 20) passed = false;
if (middle[2] !== 40) passed = false;

const strs: string[] = ["a", "b", "c", "d", "e"];
const strLast2 = strs.slice(-2);
const strAllButLast = strs.slice(0, -1);

if (strLast2.length !== 2) passed = false;
if (strLast2[0] !== "d") passed = false;
if (strLast2[1] !== "e") passed = false;

if (strAllButLast.length !== 4) passed = false;
if (strAllButLast[0] !== "a") passed = false;
if (strAllButLast[3] !== "d") passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
