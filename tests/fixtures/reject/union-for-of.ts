// @expect-reject: CS1239
// TS lets `for...of` iterate `string | string[]` (both are iterable), but the two iterate
// differently; an un-narrowed Value only supports the operations JS defines the same way for every
// kind (printing, ===, typeof, ...).
function show(x: string | string[]): void {
  for (const part of x) console.log(part);
}
show(["a", "b"]);
