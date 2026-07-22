function risky(x: number): number {
  if (x < 0) {
    throw new Error("negative: " + x);
  }
  return x * 2;
}
try {
  risky(-5);
} catch (e) {
  console.log(String(e));
  console.log(e instanceof Error);
}
try {
  throw "raw string error";
} catch (e) {
  console.log(String(e));
  console.log(e instanceof Error);
}
// rethrow
function outer(): string {
  try {
    try {
      throw new Error("deep");
    } catch (e) {
      console.log("inner caught: " + String(e));
      throw e;
    }
  } catch (e) {
    return "outer got: " + String(e);
  }
}
console.log(outer());
