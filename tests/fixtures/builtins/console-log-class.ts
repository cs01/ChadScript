// @test-description: console.log prints class instance fields
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function test() {
  const p = new Point(10, 20);
  console.log(p);
  console.log("TEST_PASSED");
}
test();
