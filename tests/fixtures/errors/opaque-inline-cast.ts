// @test-compile-error: inline type assertion
interface Node {
  type: string;
  value: number;
  name: string;
}
function process(x: Node): number {
  const y = x as unknown as { type: string; value: number };
  return y.value;
}
console.log(process({ type: "a", value: 42, name: "test" }));
