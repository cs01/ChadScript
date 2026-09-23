// @expect-reject: CS1226
// CommonJS `module.exports` is not part of the ESM subset.
function add(a: number, b: number): number {
  return a + b;
}

module.exports = { add };
