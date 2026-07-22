function parse(s: string): number {
  const n = Number(s);
  if (n !== n) {
    throw new Error("bad");
  }
  return n;
}
let sum = 0;
for (const s of ["10", "x", "20", "y", "30"]) {
  try {
    sum += parse(s);
  } catch {
    console.log("skipping " + s);
  }
}
console.log("sum = " + sum);
