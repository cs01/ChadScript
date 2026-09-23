// A callback whose parameter is wider than the element type (a union held as a Value word) gets
// each element converted, instead of reading an unboxed number as a Value.
[1, 2].forEach((x: number | string) => console.log(x, typeof x));
console.log([1, 2].map((x: number | string) => typeof x));
console.log(["a", "b"].filter((s: string | number, i: number | boolean) => i === 1 || s === "a"));
console.log(
  [3, 1, 2].sort((a: number | string, b: number | string) =>
    typeof a === "number" && typeof b === "number" ? a - b : 0,
  ),
);
console.log(
  [1, 2, 3].reduce((acc: number | string, x: number | boolean) => `${acc}${String(x)}`, ""),
);
const m = new Map<string, number>();
m.set("k", 1);
m.forEach((v: number | string, k: string | boolean) => console.log(v, k));
