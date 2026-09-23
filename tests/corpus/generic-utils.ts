// @category: generics
// A lodash-style utility belt: groupBy, chunk, zip, partition, uniqBy, keyBy, sortBy, memoize,
// pipe, and a Result type, all generic.

function groupBy<T, K extends string | number>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function zip<A, B>(as: readonly A[], bs: readonly B[]): [A, B][] {
  const n = Math.min(as.length, bs.length);
  const out: [A, B][] = [];
  for (let i = 0; i < n; i++) out.push([as[i]!, bs[i]!]);
  return out;
}

function partition<T>(xs: readonly T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const x of xs) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

function uniqBy<T, K>(xs: readonly T[], key: (x: T) => K): T[] {
  const seen = new Set<K>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sortBy<T>(xs: readonly T[], ...keys: ((x: T) => number | string)[]): T[] {
  return [...xs].sort((a, b) => {
    for (const k of keys) {
      const ka = k(a);
      const kb = k(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  });
}

function memoize<A extends string | number, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new Map<A, R>();
  return (a) => {
    if (!cache.has(a)) cache.set(a, fn(a));
    return cache.get(a)!;
  };
}

function pipe<T>(...fns: ((x: T) => T)[]): (x: T) => T {
  return (x) => fns.reduce((acc, f) => f(acc), x);
}

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function tryParseInt(s: string): Result<number> {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? { ok: false, error: `not a number: ${s}` } : { ok: true, value: n };
}

function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return { ok: true, value: values };
}

interface Employee {
  name: string;
  team: string;
  salary: number;
}
const staff: Employee[] = [
  { name: "Zed", team: "core", salary: 120 },
  { name: "Amy", team: "web", salary: 95 },
  { name: "Bo", team: "core", salary: 110 },
  { name: "Cy", team: "infra", salary: 105 },
  { name: "Di", team: "web", salary: 130 },
];

for (const [team, members] of groupBy(staff, (e) => e.team)) {
  console.log(team, members.map((m) => m.name).join(","));
}
console.log(chunk([1, 2, 3, 4, 5, 6, 7], 3));
console.log(zip(["a", "b", "c"], [1, 2]));
const [rich, rest] = partition(staff, (e) => e.salary > 108);
console.log(rich.length, rest.length);
console.log(uniqBy(staff, (e) => e.team).map((e) => e.name));
console.log(
  sortBy(
    staff,
    (e) => e.team,
    (e) => -e.salary,
  )
    .map((e) => `${e.team}:${e.name}`)
    .join(" "),
);

let computed = 0;
const square = memoize((n: number) => {
  computed++;
  return n * n;
});
console.log([3, 4, 3, 3, 4, 5].map(square), `computed ${computed} times`);

const slugify = pipe<string>(
  (s) => s.trim(),
  (s) => s.toLowerCase(),
  (s) => s.replace(/[^a-z0-9]+/g, "-"),
  (s) => s.replace(/^-|-$/g, ""),
);
console.log(slugify("  Hello, World! TypeScript 5  "));
console.log(collect(["1", "22", "333"].map(tryParseInt)));
console.log(collect(["1", "x", "3"].map(tryParseInt)));
