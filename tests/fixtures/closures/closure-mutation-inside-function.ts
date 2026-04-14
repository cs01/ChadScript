// @test-compile-error: variable 'x' is captured by a closure but reassigned after capture
// @test-description: closure mutation detected inside a function body (not just top-level)
function outer() {
  let x = 0;
  const g = () => x;
  x = 1;
  g();
}
outer();
