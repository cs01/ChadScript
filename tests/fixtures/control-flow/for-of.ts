let nums: number[] = [10, 20, 30, 40, 50];
let sum: number = 0;
for (const n of nums) {
  sum = sum + n;
}
console.log(sum);

let words: string[] = ["hello", "world", "foo"];
for (const w of words) {
  console.log(w);
}

let count: number = 0;
for (const x of nums) {
  if (x > 25) {
    count = count + 1;
  }
}
console.log(count);
