// Map with string keys: hashing (currently linear scan in the runtime), string construction, and
// a million lookups.
const N = 20000;
const Q = 200000;

const m = new Map<string, number>();
for (let i = 0; i < N; i++) {
  m.set("key" + i, i);
}

let sum = 0;
for (let q = 0; q < Q; q++) {
  const v = m.get("key" + (q % N));
  if (v !== undefined) sum = sum + v;
}
console.log(sum);
