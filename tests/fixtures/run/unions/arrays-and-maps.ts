// Value unions as array elements and Map values: literals, push, index reads (narrowed and not),
// for-of, pop/shift/at, find, includes/indexOf, join, callbacks, and printing.
const xs: (number | string)[] = [1, "two", 3];
xs.push("four");
xs.push(5);
console.log(xs, xs.length, xs.join("-"));
for (const x of xs) {
  if (typeof x === "number") console.log("n", x * 10);
  else console.log("s", x.toUpperCase());
}
const first = xs[0];
console.log(first, typeof first, xs[10], xs[1] === "two", xs[0] === 1);
const e2 = xs[2];
if (typeof e2 === "number") console.log(e2 + 0.5);
console.log(xs.includes("two"), xs.includes(3), xs.includes("3"), xs.indexOf(5), xs.indexOf("x"));
const last = xs.pop();
const head = xs.shift();
console.log(last, head, xs, xs.at(-1), xs.at(7));
const found = xs.find((v) => typeof v === "string");
console.log(found);
const lens = xs.map((v) => (typeof v === "string" ? v.length : v));
console.log(
  lens,
  xs.filter((v) => typeof v === "number"),
);
const strs: string[] = [];
xs.forEach((v) => strs.push(`${v}`));
console.log(strs);
const ys: (string | boolean | undefined)[] = ["a", true, undefined];
ys[1] = false;
ys[2] = "c";
console.log(ys, JSON.stringify(xs));

const m = new Map<string, number | string | boolean>();
m.set("a", 1);
m.set("b", "bee");
m.set("c", true);
console.log(m, m.get("a"), m.get("b"), m.get("zz"), m.size);
const got = m.get("b");
if (typeof got === "string") console.log(got.length);
for (const k of m.keys()) {
  const v = m.get(k);
  console.log(k, v, typeof v);
}
console.log([...m.values()]);
const vals: (number | string | boolean)[] = [...m.values()];
console.log(vals.length);
