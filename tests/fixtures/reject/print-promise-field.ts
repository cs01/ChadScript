// @expect-reject: CS1238
// Node prints a Promise field with its settled state (`Promise { 1 }`); the formatter cannot see it.
interface Holder {
  n: number;
  p: Promise<number>;
}
async function f(): Promise<number> {
  return 1;
}
const h: Holder = { n: 1, p: f() };
console.log(h);
