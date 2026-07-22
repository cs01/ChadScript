function risky(x: number): number {
  if (x < 0) {
    throw new Error("neg");
  }
  return x * 2;
}
try {
  console.log("a: " + risky(3));
} finally {
  console.log("a cleanup");
}
try {
  console.log("b: " + risky(4));
} catch {
  console.log("b caught");
} finally {
  console.log("b cleanup");
}
try {
  console.log("c: " + risky(-1));
} catch {
  console.log("c caught");
} finally {
  console.log("c cleanup");
}
console.log("done");
