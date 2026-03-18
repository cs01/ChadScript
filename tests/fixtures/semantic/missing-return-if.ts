// @test-description: reject function with missing return in else branch
// @test-compile-error: does not return a value on all code paths
function check(x: number): number {
  if (x > 0) {
    return 1;
  }
}

check(5);
