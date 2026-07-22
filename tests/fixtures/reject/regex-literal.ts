// @expect-reject: CS1213
const re = /ab+c/;
console.log(re.test("abbc"));
