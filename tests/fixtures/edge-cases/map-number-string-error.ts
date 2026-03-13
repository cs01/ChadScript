// @test-description: Map<number, string> should give a clear error instead of crashing
// @test-compile-error: Map<number, string> is not supported
function test(): void {
  const m = new Map<number, string>();
  m.set(1, "hello");
}
test();
