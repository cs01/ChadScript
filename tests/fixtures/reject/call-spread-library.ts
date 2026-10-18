// @expect-reject: CS1000
const xs: string[] = ["a", "b"];
console.log("x".concat(...xs));
const t: [number, number] = [3, 1];
console.log(Math.max(...t));
