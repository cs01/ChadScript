let sum = 0;
let i = 1;
while (i <= 100) {
  sum = sum + i;
  i = i + 1;
}
if (sum !== 5050) process.exit(1);

let count = 0;
let n = 1024;
while (n > 1) {
  n = Math.floor(n / 2);
  count = count + 1;
}
if (count !== 10) process.exit(1);

const arr: number[] = [];
let j = 0;
while (j < 10) {
  arr.push(j * j);
  j = j + 1;
}
if (arr.length !== 10) process.exit(1);
if (arr[0] !== 0) process.exit(1);
if (arr[9] !== 81) process.exit(1);

let str = "";
let k = 0;
while (k < 5) {
  str = str + "x";
  k = k + 1;
}
if (str !== "xxxxx") process.exit(1);

console.log("TEST_PASSED");
