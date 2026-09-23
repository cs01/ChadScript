// @expect-reject: CS1000
const p = new Promise<number>(async (resolve: (value: number) => void): Promise<void> => {
  resolve(1);
});
async function main(): Promise<void> {
  console.log(await p);
}
main();
