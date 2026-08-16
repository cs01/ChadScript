// @expect-reject: CS0001
// `clearTimeout` needs an opaque handle type the value domain does not have, so setTimeout
// returns void and clearTimeout is not declared at all.
setTimeout(() => {
  console.log("x");
}, 1);
clearTimeout(1);
