// @test-compile-error: variable 'x' is captured by a closure but reassigned after capture
// @test-description: reassigning a captured variable is a compile error
let x = 1;
const f = () => console.log(x);
x = 2;
f();
