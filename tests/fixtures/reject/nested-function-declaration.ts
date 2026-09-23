// @expect-reject: CS1000
function outer(n: number): number {
  function inner(k: number): number {
    return k * 2;
  }
  return inner(n) + 1;
}
console.log(outer(3));
