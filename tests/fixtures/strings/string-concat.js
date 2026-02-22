// @test-exit-code: 10
function concat() {
  const hello = "Hello";
  const world = "World";
  const combined = hello + world;
  return combined.length; // Should return 10
}

process.exit(concat());
