// A throw inside an async function rejects its promise; try/catch around the await catches it.
async function boom(): Promise<number> {
  throw new Error("nope");
}
async function run(): Promise<void> {
  try {
    const x = await boom();
    console.log(x);
  } catch (e) {
    console.log("caught", e instanceof Error, String(e));
  }
}
run();
