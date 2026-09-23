// An async function's mutable local captured by a closure, mutated across awaits.
async function tick(): Promise<number> {
  return 1;
}

async function run(): Promise<void> {
  let count = 0;
  const bump = (by: number): void => {
    count += by;
  };
  bump(await tick());
  bump(await tick());
  const later = (): number => count;
  count *= 10;
  console.log(count, later());
}

let finished = false;
async function main(): Promise<void> {
  await run();
  finished = true;
  console.log("done", finished);
}
main();
console.log("sync end", finished);
