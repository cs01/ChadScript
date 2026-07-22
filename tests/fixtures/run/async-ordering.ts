// A microtask boundary: sync code after starting an async call runs before the awaited continuation.
async function other(): Promise<void> {
  console.log("C-start");
}
async function run(): Promise<void> {
  console.log("A");
  const p = other();
  console.log("B");
  await p;
  console.log("D");
}
run();
console.log("top-end");
