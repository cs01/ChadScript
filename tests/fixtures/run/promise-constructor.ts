// @known-bug: `new Promise(executor)` passes the validator and then ICEs in lower ("`new` on a non-class type"); should be admitted or rejected with a CS code
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}
async function main(): Promise<void> {
  await sleep(1);
  console.log("woke");
}
main();
