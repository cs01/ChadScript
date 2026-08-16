// clearTimeout cancels a pending timer; clearing one that already fired, or clearing twice, is a
// no-op (the handle is a tombstone, not a live index).
const keep = setTimeout(() => {
  console.log("kept");
}, 5);
const drop = setTimeout(() => {
  console.log("SHOULD NOT RUN");
}, 1);
clearTimeout(drop);
clearTimeout(drop);
console.log("sync");

const alone = setTimeout(() => {
  console.log("SHOULD NOT RUN EITHER");
}, 2);
clearTimeout(alone);
clearTimeout(keep);
console.log("all cleared");
