// Checked `x!` on reads whose assertion holds: Map.get, array index, optional fields, nullable
// params, optional chains of calls and methods on the asserted value.
const m = new Map<string, number[]>();
m.set("k", [1]);
m.get("k")!.push(2);
console.log(m.get("k")!, m.get("k")!.length);
const counts = new Map<string, number>([["a", 1]]);
counts.set("a", counts.get("a")! + 1);
console.log(counts.get("a")!);
const xs: number[] = [10, 20, 30];
let total = 0;
for (let i = 0; i < xs.length; i++) total += xs[i]! * 2;
console.log(total);
const words: string[] = ["alpha", "be"];
console.log(words[0]!.toUpperCase(), words[1]!.length);
interface Node {
  name: string;
  next?: Node;
}
const list: Node = { name: "a", next: { name: "b", next: { name: "c" } } };
console.log(list.next!.next!.name);
function len(s: string | null): number {
  return s!.length;
}
console.log(len("four"));
const f: (() => number) | undefined = () => 3;
console.log(f!());
const grid: number[][] = [
  [1, 2],
  [3, 4],
];
console.log(grid[1]![0]!);
const u: string | number | undefined = words.length > 5 ? undefined : "s";
console.log(u!);
