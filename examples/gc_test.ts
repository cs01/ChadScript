const arr: number[] = [];
let i = 0;
while (i < 1000) {
  arr.push(i);
  i = i + 1;
}
console.log("Array length:");
console.log(arr.length);
const sum = arr[0] + arr[1] + arr[999];
console.log("Sum of first two and last:");
console.log(sum);

if (arr.length === 1000 && sum === 1000) {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED");
  process.exit(1);
}
