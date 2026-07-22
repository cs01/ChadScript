const data = [10, 25, 5, 40];
let total = 0;
let max = 0;
for (const v of data) {
  total += v;
  if (v > max) {
    max = v;
  }
}
console.log("total", total, "max", max);
