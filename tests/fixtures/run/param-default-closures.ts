// Defaults and optional parameters on arrows and function expressions, closures called through a
// function type, higher-order functions passing fewer arguments, and a defaulted parameter that a
// closure captures and the body reassigns (a heap cell).
const add = (a: number, b = 10): number => a + b;
console.log(add(1), add(1, 2), add(1, undefined));

const fe = function (s: string, n?: number): string {
  return s.repeat(n ?? 2);
};
console.log(fe("ab"), fe("ab", 3));

type Fmt = (x: number, digits?: number) => string;
const fmt: Fmt = (x, digits = 1) => x.toFixed(digits);
console.log(fmt(3.14159), fmt(3.14159, 3));

function apply(f: (x: number, y?: number) => number): number {
  return f(1) + f(1, 100);
}
console.log(apply((x, y = 5) => x * y));
console.log(apply((x, y) => x + (y ?? -1)));
console.log(apply((x) => x * 3));

function counter(start = 0): () => number {
  let n = start;
  return () => ++n;
}
const c1 = counter();
const c2 = counter(10);
console.log(c1(), c1(), c2());

function captured(x = 1): number {
  const get = (): number => x;
  x = x + 41;
  return get();
}
console.log(captured(), captured(8));

function capturedDefault(a: number, g = (): number => a * 2): number {
  return g();
}
console.log(
  capturedDefault(3),
  capturedDefault(3, () => 0),
);

let effects = 0;
const lazy = (x: number = ++effects): number => x;
console.log(lazy(), lazy(5), lazy(), effects);

console.log([1, 2, 3].map((x) => add(x)));

function fnRef(a: number, b = 7): number {
  return a - b;
}
const viaType: (a: number, b?: number) => number = fnRef;
console.log(viaType(10), viaType(10, 1));

function makeAdder(by = 1): (x: number) => number {
  return (x) => x + by;
}
console.log(makeAdder()(1), makeAdder(5)(1));
