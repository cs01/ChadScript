const ss = new Set<string>(["alpha", "beta", "gamma"]);
for (const x of ss) {
  console.log("s:" + x);
}

const ns = new Set<number>([10, 20, 30]);
for (const n of ns) {
  console.log("n:" + String(n));
}

let count = 0;
for (const _ of ss) count++;
console.log("count=" + String(count));
