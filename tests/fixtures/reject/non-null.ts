// @expect-reject: CS1204
function f(x: number | null): number {
  return x!;
}
f(1);
