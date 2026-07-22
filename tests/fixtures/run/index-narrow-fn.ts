function safeGet(arr: number[], i: number): number {
  const v = arr[i];
  if (v !== undefined) {
    return v;
  }
  return 0;
}
console.log(safeGet([5, 10, 15], 1));
console.log(safeGet([5, 10, 15], 10));
