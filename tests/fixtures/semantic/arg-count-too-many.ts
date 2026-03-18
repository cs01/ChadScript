// @test-description: reject call with too many arguments
// @test-compile-error: expects at most 1 argument(s) but got 3
function greet(name: string): void {
  console.log("hello " + name);
}

greet("a", "b", "c");
