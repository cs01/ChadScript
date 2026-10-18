// @expect-reject: CS1217
interface Opts {
  a?: number;
}
function f({ a }: Opts = {}): number {
  return a ?? 0;
}
console.log(f());
