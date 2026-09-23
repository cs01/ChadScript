// Delete-then-re-add moves a key to the end, so a live iterator visits it again; re-adding a key
// that was never deleted keeps its position and is not revisited.
const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);
let steps = 0;
for (const k of m.keys()) {
  console.log(k, m.get(k));
  steps++;
  if (steps < 4 && k === "a") {
    m.delete("a");
    m.set("a", 10 + steps);
  }
  m.set("b", 20 + steps);
}
console.log([...m.keys()], [...m.values()]);
const s = new Set<number>([1, 2]);
let n = 0;
for (const v of s.values()) {
  console.log("s", v);
  if (n++ < 3) {
    s.delete(v);
    s.add(v);
  }
}
console.log(s);
