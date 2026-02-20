// Test all Math functions
function testSqrt(x) {
  return Math.sqrt(x);
}

function testPow(base, exp) {
  return Math.pow(base, exp);
}

function testFloor(x) {
  return Math.floor(x);
}

function testCeil(x) {
  return Math.ceil(x);
}

function testRound(x) {
  return Math.round(x);
}

function testAbs(x) {
  return Math.abs(x);
}

console.log("sqrt(16)=" + testSqrt(16));
console.log("pow(2,8)=" + testPow(2, 8));
console.log("floor(3.7)=" + testFloor(3.7));
console.log("ceil(3.2)=" + testCeil(3.2));
console.log("round(3.5)=" + testRound(3.5));
console.log("round(3.4)=" + testRound(3.4));
console.log("abs(-42)=" + testAbs(-42));

process.exit(0);
