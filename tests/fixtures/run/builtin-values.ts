// Built-in functions used as values behave as Node's do: each receives every argument its caller
// passes (map passes the index as parseInt's radix), and a builtin is one function object.
console.log([1, 2.5, -0].map(String));
console.log(["1", "x", " 7 ", ""].map(Number));
console.log([0, 1, NaN].map(Boolean), ["", "a"].map(Boolean));
console.log(["1", "2", "3", "10", "11"].map(parseInt));
console.log(["1.5", "2e3", "x"].map(parseFloat));
console.log([1.5, -2.5, 3.7].map(Math.floor), [1.2, 2.8].map(Math.round), [-3].map(Math.abs));
console.log(
  [4, 9].map(Math.sqrt),
  [1.5].map(Math.ceil),
  [-1.9].map(Math.trunc),
  [-4].map(Math.sign),
);
const pairs: number[][] = [
  [1, 5],
  [7, 2],
];
console.log(pairs.map((p) => Math.max(p[0] ?? 0, p[1] ?? 0)));
[10, 20].forEach(console.log);
["a%sb", "c"].forEach(console.log);
const toText: (n: number) => string = String;
const toNum: (s: string) => number = Number;
console.log(toText(42), toNum("12"));
const fns: ((n: number) => number)[] = [Math.floor, Math.ceil, Math.floor];
console.log(
  fns.map((f) => f(1.5)),
  fns[0] === fns[2],
  fns[0] === fns[1],
);
console.log(fns.indexOf(Math.ceil), fns.includes(Math.round));
const s1: (n: number) => string = String;
const s2: (b: boolean) => string = String;
const asNum: (b: boolean) => number = Number;
console.log(s1(1) + s2(true) + String(asNum(true)));
console.log(["b", "a"].map(String).sort());
const m = new Map<string, number>();
m.set("k", 2);
m.forEach(console.log);
new Set([5, 6]).forEach(console.log);
