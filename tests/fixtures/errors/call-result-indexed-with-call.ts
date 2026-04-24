// @test-compile-error: indexing a call result
function getArr(): string[] {
  return ["a", "b", "c"];
}
function getIdx(): number {
  return 1;
}
function main(): void {
  const x = getArr()[getIdx()];
  console.log(x);
}
main();
