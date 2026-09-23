// @expect-reject: CS1000
interface P {
  a: number;
  b: number;
}
const p: P = { a: 1, b: 2 };
function get(k: "a" | "b"): number {
  return p[k];
}
console.log(get("a"));
