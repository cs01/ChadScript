// A callback may be an arrow or a function expression — both lower to the {fnptr, env} closure
// record the runtime calls. A reference to a declared `function` is NOT a value in the subset
// (CS1232); reject/fn-decl-as-value.ts pins that boundary. Captures must be `const` (CS1219).
const captured = "captured value";
const label = "function expression";

setTimeout(function () {
  console.log(label);
}, 1);
setTimeout(() => {
  console.log(`arrow sees ${captured}`);
}, 2);
