const nums = [1, 2, 3, -1, 4];
let sum = 0;
for (const n of nums) {
  if (n < 0) {
    throw new Error("negative found");
  }
  sum += n;
  console.log("running: " + sum);
}
console.log("done");
