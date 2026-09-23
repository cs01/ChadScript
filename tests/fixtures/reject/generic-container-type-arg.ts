// @expect-reject: CS1242
// An erased T holds one self-describing word; an array's word does not say what its elements are.
function id<T>(x: T): T {
  return x;
}
console.log(id([1, 2]));
