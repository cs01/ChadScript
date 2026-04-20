// @test-description: issue #589 — parser accepts arr[i](args) as a call expression (ElementAccessExpression callee)
// @test-compile-error: Immediately invoked function expressions
function doubler(x: number): number {
  return x * 2;
}
function plusOne(x: number): number {
  return x + 1;
}

const fns = [doubler, plusOne];
const a = fns[0](10);
console.log(a);
