// @expect-reject: CS1232
// Codegen has no binding for a function declaration used as a value — it reached an ICE before
// this rule existed. Arrow functions assigned to a variable are the supported spelling.
function inc(x: number): number {
  return x + 1;
}

const nums = [1, 2];
console.log(nums.map(inc).join(","));
