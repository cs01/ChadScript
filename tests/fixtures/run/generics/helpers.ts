// Erased generic helpers: one compiled body each, called at several instantiations, with explicit
// and inferred type arguments.
function identity<T>(x: T): T {
  return x;
}

function last<T>(xs: T[]): T | undefined {
  return xs[xs.length - 1];
}

function map<T, U>(xs: T[], f: (x: T) => U): U[] {
  const out: U[] = [];
  for (const x of xs) out.push(f(x));
  return out;
}

function keep<T>(xs: T[], pred: (x: T) => boolean): T[] {
  return xs.filter(pred);
}

function pair<A, B>(a: A, b: B): { a: A; b: B } {
  return { a, b };
}

function describe<T>(x: T): string {
  if (typeof x === "number") return `num ${x + 1}`;
  if (typeof x === "string") return `str ${x.length}`;
  return x === null ? "null" : "other";
}

function orElse<T>(x: T | undefined, d: T): T {
  return x === undefined ? d : x;
}

console.log(identity(5), identity("s"), identity(true), identity<number | string>("u"));
console.log(identity(null), identity(undefined));
console.log(last([1, 2, 3]), last<number>([]), last(["p", "q"]));
const doubled = map([1, 2, 3], (x) => x * 2);
console.log(doubled, doubled.length, doubled[0]);
const lens = map(["a", "bb", "ccc"], (s) => s.length);
console.log(lens.join("+"));
const shouted = map<number, string>([1, 2], (n) => `${n}!`);
console.log(shouted);
console.log(keep([5, 6, 7, 8], (n) => n % 2 === 0));
const p = pair(1, "one");
console.log(p.a + 1, p.b.toUpperCase(), p);
console.log(describe(41), describe("x"), describe(null), describe(false));
console.log(orElse<number>(undefined, 7), orElse("set", "unset"));
const total = identity(20) + identity(22);
console.log(total);
