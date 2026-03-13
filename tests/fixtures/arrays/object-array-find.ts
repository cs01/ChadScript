interface Point {
  x: number;
  y: number;
}
const points: Point[] = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
  { x: 5, y: 6 },
];
const found = points.find((p: Point) => p.x === 3);
if (found !== null && found !== undefined) {
  if (found.y === 4) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: found.y = " + found.y);
  }
} else {
  console.log("FAIL: not found");
}
