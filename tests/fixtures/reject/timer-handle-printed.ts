// @expect-reject: CS1234
// Node prints a `Timeout` object with internal fields; there is nothing faithful for us to print,
// which is exactly why the type is opaque.
const t = setTimeout(() => {
  console.log("x");
}, 1);
console.log(t);
