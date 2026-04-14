// @test-compile-error: variable 'x' is captured by a closure but reassigned after capture
// @test-description: closure mutation detected when assignment is inside the arrow body itself
function outer() {
  let x = 0;
  const g = () => {
    x = 1;
  };
  g();
}
outer();
