class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const points: Point[] = [];
points.push(new Point(1, 2));
points.push(new Point(3, 4));
points.push(new Point(5, 6));

console.log(points.length);

const first = points[0];
console.log(first.x);
console.log(first.y);

const second = points[1];
console.log(second.x);
console.log(second.y);

if (first.x === 1 && first.y === 2 && second.x === 3 && second.y === 4) {
  console.log("TEST_PASSED");
}
