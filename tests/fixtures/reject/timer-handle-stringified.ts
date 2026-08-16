// @expect-reject: CS1234
const t = setTimeout(() => {
  console.log("x");
}, 1);
console.log(JSON.stringify(t));
