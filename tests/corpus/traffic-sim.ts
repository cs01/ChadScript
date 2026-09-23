// @category: simulation
// The Nagel-Schreckenberg traffic model on a ring road: acceleration, braking, random slowdowns
// (seeded), and movement. Prints a space-time diagram and flow statistics for several densities.

const ROAD = 60;
const VMAX = 5;

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

interface Car {
  pos: number;
  v: number;
}

function simulate(
  density: number,
  steps: number,
  pSlow: number,
  seed: number,
  draw: boolean,
): { flow: number; avgSpeed: number } {
  const rand = lcg(seed);
  const cars: Car[] = [];
  const n = Math.round(ROAD * density);
  for (let i = 0; i < n; i++) cars.push({ pos: Math.floor((i * ROAD) / n), v: 0 });
  let moved = 0;
  let speedSum = 0;
  for (let t = 0; t < steps; t++) {
    cars.sort((a, b) => a.pos - b.pos);
    const gaps = cars.map((c, i) => {
      const ahead = cars[(i + 1) % cars.length]!;
      return (ahead.pos - c.pos - 1 + ROAD) % ROAD;
    });
    cars.forEach((c, i) => {
      c.v = Math.min(c.v + 1, VMAX, gaps[i]!);
      if (c.v > 0 && rand() < pSlow) c.v--;
    });
    for (const c of cars) {
      c.pos = (c.pos + c.v) % ROAD;
      moved += c.v;
      speedSum += c.v;
    }
    if (draw && t < 12) {
      const row = new Array<string>(ROAD).fill(".");
      for (const c of cars) row[c.pos] = String(c.v);
      console.log(row.join(""));
    }
  }
  return { flow: moved / (steps * ROAD), avgSpeed: speedSum / (steps * Math.max(1, cars.length)) };
}

simulate(0.2, 12, 0.3, 42, true);
console.log("density  flow   avg-speed");
for (const d of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8]) {
  const r = simulate(d, 200, 0.3, 7, false);
  console.log(`${d.toFixed(2).padStart(7)}  ${r.flow.toFixed(3)}  ${r.avgSpeed.toFixed(3)}`);
}
