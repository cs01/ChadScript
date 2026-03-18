// @test-description: reject call with too many arguments
// @test-compile-error: expects at most 1 argument(s) but got 3
function greet(name: string): string {
  return "hi " + name;
}

const x = greet("a", "b", "c");
