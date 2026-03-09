interface Point {
  x: number;
  y: number;
}

function getPoint(): Point {
  return { x: 10, y: 20 };
}

const { x, y } = getPoint();

if (x === 10 && y === 20) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: x=" + x + " y=" + y);
}
