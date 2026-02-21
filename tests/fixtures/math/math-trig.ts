function testMathTrig(): void {
  const logE = Math.log(2.718281828459045);
  if (logE < 0.999 || logE > 1.001) {
    console.log("FAIL: log(e)");
    process.exit(1);
  }

  const log1 = Math.log(1);
  if (log1 !== 0) {
    console.log("FAIL: log(1)");
    process.exit(1);
  }

  const sinZero = Math.sin(0);
  if (sinZero !== 0) {
    console.log("FAIL: sin(0)");
    process.exit(1);
  }

  const cosZero = Math.cos(0);
  if (cosZero !== 1) {
    console.log("FAIL: cos(0)");
    process.exit(1);
  }

  const sinPiHalf = Math.sin(1.5707963267948966);
  if (sinPiHalf < 0.999 || sinPiHalf > 1.001) {
    console.log("FAIL: sin(pi/2)");
    process.exit(1);
  }

  const cosPi = Math.cos(3.141592653589793);
  if (cosPi < -1.001 || cosPi > -0.999) {
    console.log("FAIL: cos(pi)");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testMathTrig();
