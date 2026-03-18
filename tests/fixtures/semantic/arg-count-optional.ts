// @test-description: optional params should allow fewer args
function greet(name: string, greeting?: string): string {
  if (greeting) {
    return greeting + " " + name;
  }
  return "hello " + name;
}

const a = greet("world");
const b = greet("world", "hi");
if (a === "hello world" && b === "hi world") {
  console.log("TEST_PASSED");
}
