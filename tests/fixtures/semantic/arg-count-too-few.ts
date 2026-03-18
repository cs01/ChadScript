// @test-description: reject call with too few arguments
// @test-compile-error: expects at least 2 argument(s) but got 1
function add(a: number, b: number): number {
  return a + b;
}

const x = add(1);
