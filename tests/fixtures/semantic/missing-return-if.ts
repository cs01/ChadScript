// @test-description: reject function missing return in else branch
// @test-compile-error: does not return a value on all code paths
function check(x: number): string {
  if (x > 0) {
    return "positive";
  }
}
