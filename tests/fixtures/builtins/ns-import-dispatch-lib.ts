// @test-skip
// Helper module for ns-import-dispatch.ts — not a standalone fixture.
export function greet(): string {
  return "hello";
}

export function double(n: number): number {
  return n * 2;
}
