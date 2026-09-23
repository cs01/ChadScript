// Two live iterators over the same map at once: the inner loop deletes and adds, and the outer
// iterator (suspended mid-walk) must see the same changes Node's does.
const m = new Map<number, string>();
for (let i = 1; i <= 6; i++) m.set(i, "v" + i);
for (const a of m.keys()) {
  const row: number[] = [];
  for (const b of m.keys()) {
    row.push(b);
    if (a === 2 && b === 3) m.delete(4);
    if (a === 3 && b === 5) m.set(7, "v7");
  }
  console.log(a, row.join(" "));
  if (a === 5) m.delete(6);
}
// Many deletes while an outer iterator is parked, so the table compacts under it.
const big = new Map<number, number>();
for (let i = 0; i < 64; i++) big.set(i, i);
const order: number[] = [];
for (const k of big.keys()) {
  order.push(k);
  if (k === 3) {
    for (const j of big.keys()) if (j > 3 && j % 4 !== 0) big.delete(j);
    for (let i = 100; i < 140; i++) big.set(i, i);
  }
}
console.log(order.join(","));
console.log(big.size);
