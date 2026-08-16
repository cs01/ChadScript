// The microtask queue must drain FULLY between two timer callbacks: the awaiting fiber has to
// resume before the next timer fires, not after all timers are done.
async function work(label: string): Promise<string> {
  return label;
}

async function main(): Promise<void> {
  const a = await work("await-1");
  console.log(a);
  setTimeout(() => {
    console.log("timer-mid");
  }, 5);
  const b = await work("await-2");
  console.log(b);
}

setTimeout(() => {
  console.log("timer-early");
}, 1);
main();
setTimeout(() => {
  console.log("timer-late");
}, 10);
console.log("sync");
