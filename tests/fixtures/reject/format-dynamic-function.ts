// @expect-reject: CS1238
// A first argument that is a string only at run time can hold any directive, so a function
// argument could meet %s (its source text) or %o (its hidden properties).
function add(a: number): number {
  return a + 1;
}
const label: string = ["x"].join("");
console.log(label, add);
