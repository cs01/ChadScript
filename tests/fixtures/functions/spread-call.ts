// Spread in function calls: ...arr passes array to rest parameter
function sum(...nums: number[]): number {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    total = total + nums[i];
  }
  return total;
}

const numbers: number[] = [1, 2, 3, 4];
const result = sum(...numbers);

if (result === 10) {
  console.log("TEST_PASSED");
}
