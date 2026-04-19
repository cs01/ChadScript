interface Coord {
  x: number;
  y: number;
  z: number;
}

function main(): void {
  const p = { z: 30, y: 20, x: 10 } as Coord;
  if (p.x === 10 && p.y === 20 && p.z === 30) {
    console.log("TEST_PASSED");
  }
}

main();
