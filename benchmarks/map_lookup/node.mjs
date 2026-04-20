const N = 100000;
const Q = 1000000;

const m = new Map();
for (let i = 0; i < N; i++) m.set("key" + i, i);

const start = process.hrtime.bigint();
let sum = 0;
for (let q = 0; q < Q; q++) {
  const v = m.get("key" + (q % N));
  if (v !== undefined) sum += v;
}
const elapsed = Number(process.hrtime.bigint() - start) / 1e9;

console.log("Sum:      " + sum);
console.log("Time:     " + elapsed.toFixed(6) + "s");
