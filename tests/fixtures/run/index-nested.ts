function at(arr: number[], i: number): number {
  return arr[i] ?? -1;
}
console.log(at([1, 2, 3], 1));
console.log(at([1, 2, 3], 10));
