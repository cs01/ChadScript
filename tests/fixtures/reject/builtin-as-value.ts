// @expect-reject: CS1246
console.log([1, 2].map(String));
console.log(["1", "x"].map(Number), [0, 1].map(Boolean));
