// @expect-reject: CS1240
// The returned array is the argument itself, not one the callee built, so converting it would copy.
function same<T>(xs: T[]): T[] {
  return xs;
}
console.log(same([1, 2]));
