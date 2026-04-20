const N = 100000;
const Q = 1000000;

const m = new Map<string, number>();
let i = 0;
while (i < N) {
  m.set("key" + i, i);
  i = i + 1;
}

const start = Date.now();
let sum = 0;
let q = 0;
while (q < Q) {
  const v = m.get("key" + (q % N));
  if (v !== undefined) sum = sum + v;
  q = q + 1;
}
const elapsed = (Date.now() - start) / 1000;

console.log("Sum:      " + sum);
console.log("Time:     " + elapsed + "s");
