// @expect-reject: CS1228
// The arrow reads `factor` when forEach calls it, which is before `factor` is initialized: Node
// throws ReferenceError.
const out: number[] = [];
[1, 2].forEach((x) => out.push(x * factor));
const factor = 3;
console.log(out);
