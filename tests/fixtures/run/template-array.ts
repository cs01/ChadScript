// @known-bug: an array interpolated into a template literal passes the validator and then ICEs in codegen ("coerceToString: array not supported yet")
const xs: number[] = [1, 2];
console.log(`xs=${xs}`);
