// The microtask queue must drain FULLY between two timer callbacks: the awaiting fiber has to
// resume before the next timer fires, not after all timers are done.
// `timer-from-fiber` shares timer-late's delay so it fires after it by FIFO order. A shorter 5 ms delay
// raced timer-late under load: it is armed a microtask turn later, and when that turn slipped
// past 5 ms Node printed late before mid while the native binary did not.
async function work(label: string): Promise<string> {
  return label;
}

async function main(): Promise<void> {
  const a = await work("await-1");
  console.log(a);
  setTimeout(() => {
    console.log("timer-from-fiber");
  }, 10);
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
