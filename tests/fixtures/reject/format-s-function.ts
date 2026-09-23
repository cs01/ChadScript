// @expect-reject: CS1238
// %s of a function prints its source text in Node.
function add(a: number): number {
  return a + 1;
}
console.log("%s", add);
