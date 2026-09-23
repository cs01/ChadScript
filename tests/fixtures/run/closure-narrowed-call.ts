// Function values reached through narrowing, fields, ?? and conditionals, then called.
function run(f: (() => number) | undefined): number {
  const r = f === undefined ? 0 : f();
  return r;
}
console.log(
  run(undefined),
  run(() => 5),
);
interface Ops {
  f: (x: number) => number;
  g: ((x: number) => number) | undefined;
}
const o: Ops = { f: (x) => x + 1, g: undefined };
const h = o.f;
console.log(h(1), o.f(2));
const fns = [(x: number) => x * 2, (x: number) => x * 3];
const first = fns[0];
if (first !== undefined) console.log(first(5));
const k = o.g;
console.log(k === undefined ? -1 : k(3));
const m = new Map<string, (x: number) => number>();
m.set("sq", (x) => x * x);
const sq = m.get("sq");
if (sq) console.log(sq(4));
function pick(b: boolean, a: Ops, fs: ((x: number) => number)[]): (x: number) => number {
  return b ? a.f : (fs[1] ?? a.f);
}
console.log(pick(true, o, fns)(1), pick(false, o, fns)(1));
let cb: ((s: string) => void) | undefined = undefined;
cb = (s) => console.log("cb", s);
if (cb) cb("hi");
