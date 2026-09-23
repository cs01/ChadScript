// @category: simulation
// Langton's ant on a sparse grid (a Set of "x,y" keys), run for 11,000 steps until the highway
// appears, then the bounding box is rendered.

type Heading = 0 | 1 | 2 | 3; // up, right, down, left

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

let black = new Set<string>();
let x = 0;
let y = 0;
let heading: Heading = 0;

function turn(right: boolean): void {
  heading = ((heading + (right ? 1 : 3)) % 4) as Heading;
}

const checkpoints = [100, 500, 1000, 5000, 10000, 11000];
for (let step = 1; step <= 11000; step++) {
  const key = `${x},${y}`;
  if (black.has(key)) {
    turn(false);
    black.delete(key);
  } else {
    turn(true);
    black.add(key);
  }
  x += DX[heading]!;
  y += DY[heading]!;
  if (checkpoints.includes(step)) {
    console.log(
      `step ${String(step).padStart(5)}: ${black.size} black cells, ant at (${x}, ${y}) facing ${"URDL"[heading]}`,
    );
  }
}

let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
for (const key of black) {
  const [cx, cy] = key.split(",").map(Number) as [number, number];
  minX = Math.min(minX, cx);
  maxX = Math.max(maxX, cx);
  minY = Math.min(minY, cy);
  maxY = Math.max(maxY, cy);
}
console.log(`bounding box: x ${minX}..${maxX}, y ${minY}..${maxY}`);
const rows: string[] = [];
for (let row = minY; row <= maxY; row += 2) {
  let line = "";
  for (let col = minX; col <= maxX; col++) {
    const top = black.has(`${col},${row}`);
    const bottom = black.has(`${col},${row + 1}`);
    line += top && bottom ? "8" : top ? "'" : bottom ? "," : " ";
  }
  rows.push(line.trimEnd());
}
console.log(rows.slice(0, 12).join("\n"));
black = new Set();
console.log(black.size);
