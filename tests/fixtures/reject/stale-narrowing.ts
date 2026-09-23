// @expect-reject: CS1241
// tsc still narrows `v` to number after `flip()`, but the closure made it a string.
let n = 0;
function main(): void {
  let v: number | string = 1;
  const flip = (): void => {
    v = "now a string";
  };
  flip();
  n = v + 1;
}
main();
console.log(n);
