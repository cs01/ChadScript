// @test-exit-code: 0
// Test all bitwise operators
function testXor(a, b) {
  return a ^ b;
}

function testLeftShift(a, b) {
  return a << b;
}

function testRightShift(a, b) {
  return a >> b;
}

function testAnd(a, b) {
  return a & b;
}

function testOr(a, b) {
  return a | b;
}

console.log("XOR(5,3)=" + testXor(5, 3));
console.log("LeftShift(5,2)=" + testLeftShift(5, 2));
console.log("RightShift(20,2)=" + testRightShift(20, 2));
console.log("AND(12,10)=" + testAnd(12, 10));
console.log("OR(12,10)=" + testOr(12, 10));

process.exit(0);
