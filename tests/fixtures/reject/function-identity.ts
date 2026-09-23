// @expect-reject: CS1245
function f(): number {
  return 1;
}
function g(): number {
  return 2;
}
const h = f;
console.log(f === g, h !== f);
