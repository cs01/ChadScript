// The mutation happens inside a function the loop body calls, where no syntactic check can see it.
const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);
function prune(key: string): void {
  if (key === "a") m.delete("b");
  if (key === "c") m.set("d", 4);
}
for (const k of m.keys()) {
  prune(k);
  console.log(k);
}
const seen = new Set<number>([1]);
const grow = (v: number): void => {
  if (v < 5) seen.add(v + 1);
};
for (const v of seen.values()) {
  grow(v);
  console.log("seen", v);
}
console.log(m, seen);
