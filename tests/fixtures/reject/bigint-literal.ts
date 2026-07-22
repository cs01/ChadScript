// @expect-reject: CS1000
// BigInt is out of the subset (numbers are IEEE-754 double only). The literal token must fail
// closed at validate, not slip default-deny and ICE in lowering.
const big = 42n;
console.log(big);
