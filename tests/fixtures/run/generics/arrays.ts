// Generic functions and arrow functions that take and return arrays.
function reversed<T>(xs: T[]): T[] {
  const out: T[] = [];
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (x !== undefined) out.push(x);
  }
  return out;
}

function concatAll<T>(a: T[], b: T[]): T[] {
  return [...a, ...b];
}

function count<T>(xs: T[], x: T): number {
  let n = 0;
  for (const y of xs) if (y === x) n++;
  return n;
}

const wrap = <T>(x: T): T[] => [x, x];
const twice = <T>(f: (x: T) => T, x: T): T => f(f(x));

console.log(reversed([1, 2, 3]), reversed(["x", "y"]).join(""));
console.log(concatAll([1], [2, 3]), concatAll(["a"], []));
const nums = [4, 5, 6];
console.log(reversed([...nums]), nums);
console.log(count([1, 2, 1, 1], 1), count(["a", "b"], "c"));
const pts = [{ x: 1 }, { x: 2 }];
console.log(reversed(pts).map((p) => p.x));
console.log(
  wrap(7),
  wrap("s").length,
  twice((n) => n * 3, 2),
  twice((s) => s + "!", "hi"),
);
const sum = reversed([1.5, 2.5]).reduce((a, b) => a + b, 0);
console.log(sum);
