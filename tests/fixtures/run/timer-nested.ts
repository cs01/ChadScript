// A timer scheduled from inside a timer callback joins the queue and runs in a later turn.
// `sibling` shares outer's delay so it is due in the same turn by FIFO order; a 2 ms delay
// raced the nested 1 ms timer under load and made the order depend on scheduling jitter.
setTimeout(() => {
  console.log("outer");
  setTimeout(() => {
    console.log("inner");
  }, 1);
}, 1);
setTimeout(() => {
  console.log("sibling");
}, 1);
console.log("main");
