// @test-compile-error: opacifies the result type
interface Box {
  items: string[];
  name: string;
}
function getBox(): Box | null {
  return null;
}
function main(): void {
  const b = getBox() || { items: ["x", "y"], name: "default" };
  console.log("count=" + b.items.length);
}
main();
