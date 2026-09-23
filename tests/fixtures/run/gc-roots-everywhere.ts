// Collector roots: values reachable only from a closure env with mixed number/pointer captures, a
// heap cell, an optional box, a Map, a Set and large arrays (the large-object space) must all
// survive heavy allocation between their creation and their use.
function garbage(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const tmp = { a: i, b: "g" + i, c: [i, i + 1, i + 2] };
    s += tmp.c.length + tmp.b.length;
  }
  return s;
}

function makeCounter(start: number, name: string): () => string {
  let count = start;
  const parts: string[] = [name];
  return () => {
    count += 1;
    parts.push("x" + count);
    return name + ":" + count + ":" + parts.length;
  };
}

const counter = makeCounter(10, "ctr");
const table = new Map<string, number[]>();
const seen = new Set<string>();
for (let i = 0; i < 40; i++) {
  table.set("k" + i, [i, i * 2, i * 3]);
  seen.add("s" + (i % 7));
}
const big: string[] = [];
for (let i = 0; i < 300; i++) big.push("item-" + i);
const nums: number[] = [];
for (let i = 0; i < 2000; i++) nums.push(i * 0.25);
let maybe: string | undefined = "kept-" + big.length;

let g = 0;
for (let round = 0; round < 10; round++) {
  g += garbage(500);
  counter();
}

let sum = 0;
table.forEach((v, k) => {
  sum += v.length + k.length;
});
let numSum = 0;
for (const x of nums) numSum += x;
console.log(g, counter(), sum, seen.size, big[299], big.length, numSum, maybe);
maybe = undefined;
console.log(maybe);
