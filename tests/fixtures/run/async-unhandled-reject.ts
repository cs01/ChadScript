// @known-bug: an unhandled rejection prints "Uncaught (in promise)" on stderr, not the error's first line (Node: "Error: e1")
// An unhandled rejection (a caught error re-thrown past every handler) terminates with exit code 1,
// like Node. stdout carries the pre-rejection output; the exit code is the differential signal.
async function boom(): Promise<number> {
  throw new Error("e1");
}
async function run(): Promise<void> {
  try {
    await boom();
  } catch (e) {
    console.log("caught1");
    throw e;
  }
}
run();
