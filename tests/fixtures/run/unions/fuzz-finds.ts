// Cases the union fuzzer found: a narrowed Value or optional variable read through shorthand object
// syntax, truthiness of an optional, `===` between two optionals, and arrays whose elements are
// optional (a literal of bare nulls, join, includes/indexOf).
function pick(i: number): string | null {
  return i > 1 ? "s" + i : null;
}
let x0: number | string = 1;
let x1: string | undefined = "a";
console.log({ x0, x1 }, [x0, x1]);
x0 = "now a string";
x1 = undefined;
console.log({ x0, x1 });
for (let i = 0; i < 4; i++) {
  const p = pick(i);
  console.log(p ? "truthy" : "falsy", pick(i) === pick(i + 1), pick(i) !== p, p === null);
}
const arr: (string | null)[] = [null, null];
arr.push("x");
console.log(arr, arr.join("-"), arr.includes(null), arr.indexOf("x"), arr.includes("y"));
for (let i = 0; i < 4; i++) {
  const at = arr[i];
  if (at !== undefined) console.log("at", at, typeof at, at === null);
  else console.log("no element", i, arr.at(i), arr.pop());
}
let n0: string | null = null;
const n1: number | null = null;
console.log([n0, n1], [n0, n1].length);
n0 = "set";
console.log([n0, n1]);
const nums: (number | undefined)[] = [1, undefined, NaN];
console.log(nums.join(), nums.includes(undefined), nums.indexOf(undefined), nums.includes(NaN));
const obj = { n: 1 };
const maybe: { n: number } | null = Math.max(0, 1) > 0 ? obj : null;
if (maybe) console.log("object is truthy", maybe);
