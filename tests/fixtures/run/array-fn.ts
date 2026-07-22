function sumArray(arr: number[]): number {
  let s = 0;
  for (const x of arr) {
    s += x;
  }
  return s;
}
console.log(sumArray([1, 2, 3]));
console.log(sumArray([100, 200]));
