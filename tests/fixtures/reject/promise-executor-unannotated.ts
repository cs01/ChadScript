// @expect-reject: CS1000
// The library types `resolve` as taking `T | PromiseLike<T>`, which has no representation here.
const p = new Promise<number>((resolve) => {
  resolve(1);
});
async function main(): Promise<void> {
  console.log(await p);
}
main();
