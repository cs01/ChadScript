// @test-skip
class MathHelper {
  static add(a: number, b: number): number {
    return a + b;
  }

  static multiply(a: number, b: number): number {
    return a * b;
  }
}

const sum = MathHelper.add(3, 4);
const product = MathHelper.multiply(5, 6);

if (sum === 7 && product === 30) {
  console.log("TEST_PASSED");
}
