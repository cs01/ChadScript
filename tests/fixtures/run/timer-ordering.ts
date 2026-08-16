// Deadline order wins over registration order; equal deadlines keep registration order; and a
// delay below 1ms clamps to 1ms rather than firing synchronously.
setTimeout(() => {
  console.log("d 20");
}, 20);
setTimeout(() => {
  console.log("a 0");
}, 0);
setTimeout(() => {
  console.log("b 5 first");
}, 5);
setTimeout(() => {
  console.log("c 5 second");
}, 5);
console.log("sync runs before every timer");
