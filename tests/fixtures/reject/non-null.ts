// @expect-reject: CS1204
function f(x: number | null): void {
  console.log(x!);
}
f(1);
