// @expect-reject: CS1238
async function f(): Promise<number> {
  return 1;
}
const p = f();
console.log([p]);
