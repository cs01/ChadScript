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
