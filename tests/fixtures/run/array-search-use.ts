function contains(arr: number[], x: number): string {
  if (arr.includes(x)) {
    return "found at " + arr.indexOf(x);
  }
  return "not found";
}
console.log(contains([1, 2, 3], 2));
console.log(contains([1, 2, 3], 9));
