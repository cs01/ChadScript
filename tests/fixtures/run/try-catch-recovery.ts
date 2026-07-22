function risky(x: number): number {
  if (x < 0) {
    throw new Error("negative: " + x);
  }
  return x * 2;
}
let result = 0;
try {
  result = risky(5);
  console.log("got " + result);
  result = risky(-1);
  console.log("unreachable");
} catch {
  console.log("caught an error");
  result = -99;
}
console.log("result = " + result);
