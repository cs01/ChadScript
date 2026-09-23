// @expect-reject: CS1000
const e = new Error("x");
e.message = "y";
console.log(e.message);
