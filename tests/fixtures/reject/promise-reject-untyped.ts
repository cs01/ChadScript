// @expect-reject: CS1000
const p = new Promise<number>(
  (resolve: (value: number) => void, reject: (reason: string) => void): void => {
    if (Math.max(1, 2) > 5) reject("no");
    resolve(1);
  },
);
async function main(): Promise<void> {
  console.log(await p);
}
main();
