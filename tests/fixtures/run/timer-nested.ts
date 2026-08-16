// A timer scheduled from inside a timer callback joins the queue and runs in a later turn.
setTimeout(() => {
  console.log("outer");
  setTimeout(() => {
    console.log("inner");
  }, 1);
}, 1);
setTimeout(() => {
  console.log("sibling");
}, 2);
console.log("main");
