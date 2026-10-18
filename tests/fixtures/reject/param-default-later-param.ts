// @expect-reject: CS1217
// The closure in `a`'s default would capture `b` before the prologue binds it.
function late(a = (): number => b, b = 2): number {
  return a();
}
console.log(late());
