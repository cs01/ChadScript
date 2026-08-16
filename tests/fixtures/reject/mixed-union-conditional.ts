// @expect-reject: CS1233
// Syntax-level default-deny admits `cond ? a : b`, but says nothing about whether the union of the
// arms has a runtime representation. Before this rule it reached ice("mixed-representation union").
const flag: boolean = true;
const x = flag ? "str" : 42;
console.log(x);
