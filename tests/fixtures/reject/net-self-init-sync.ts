// @expect-reject: CS1250
// `map` calls its callback right away, before `lengths` exists: Node throws a ReferenceError.
function main(): void {
  const lengths: number[] = [1, 2].map((n) => n + lengths.length);
  console.log(lengths);
}
main();
