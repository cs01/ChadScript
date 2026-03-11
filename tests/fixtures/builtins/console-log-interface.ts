// @test-description: console.log prints interface objects as json
interface Point {
  x: number;
  y: number;
}

function test() {
  const p: Point = { x: 10, y: 20 };
  console.log(p);
  console.log("TEST_PASSED");
}
test();
