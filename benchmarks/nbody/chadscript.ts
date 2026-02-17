const PI = 3.141592653589793;
const SOLAR_MASS = 4.0 * PI * PI;
const DAYS_PER_YEAR = 365.24;
const N_BODIES = 5;
const STEPS = 25000000;
const DT = 0.01;

interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  mass: number;
}

function advance(bodies: Body[]): void {
  let i = 0;
  while (i < N_BODIES) {
    let j = i + 1;
    while (j < N_BODIES) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const dz = bodies[i].z - bodies[j].z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(dist2);
      const mag = DT / (dist2 * dist);
      bodies[i].vx = bodies[i].vx - dx * bodies[j].mass * mag;
      bodies[i].vy = bodies[i].vy - dy * bodies[j].mass * mag;
      bodies[i].vz = bodies[i].vz - dz * bodies[j].mass * mag;
      bodies[j].vx = bodies[j].vx + dx * bodies[i].mass * mag;
      bodies[j].vy = bodies[j].vy + dy * bodies[i].mass * mag;
      bodies[j].vz = bodies[j].vz + dz * bodies[i].mass * mag;
      j = j + 1;
    }
    i = i + 1;
  }
  let k = 0;
  while (k < N_BODIES) {
    bodies[k].x = bodies[k].x + DT * bodies[k].vx;
    bodies[k].y = bodies[k].y + DT * bodies[k].vy;
    bodies[k].z = bodies[k].z + DT * bodies[k].vz;
    k = k + 1;
  }
}

function energy(bodies: Body[]): number {
  let e = 0.0;
  let i = 0;
  while (i < N_BODIES) {
    e = e + 0.5 * bodies[i].mass * (bodies[i].vx * bodies[i].vx + bodies[i].vy * bodies[i].vy + bodies[i].vz * bodies[i].vz);
    let j = i + 1;
    while (j < N_BODIES) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const dz = bodies[i].z - bodies[j].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e = e - bodies[i].mass * bodies[j].mass / dist;
      j = j + 1;
    }
    i = i + 1;
  }
  return e;
}

function run(): void {
  const bodies: Body[] = [];

  bodies.push({ x: 0.0, y: 0.0, z: 0.0, vx: 0.0, vy: 0.0, vz: 0.0, mass: SOLAR_MASS });
  bodies.push({ x: 4.84143144246472090, y: -1.16032004402742839, z: -0.10362204447112311, vx: 0.00166007664274403694 * DAYS_PER_YEAR, vy: 0.00769901118419740425 * DAYS_PER_YEAR, vz: -0.00006904600169720200 * DAYS_PER_YEAR, mass: 0.000954791938424326609 * SOLAR_MASS });
  bodies.push({ x: 8.34336671824457987, y: 4.12479856412430479, z: -0.40360353309630984, vx: -0.00276742510726862411 * DAYS_PER_YEAR, vy: 0.00499852801234917238 * DAYS_PER_YEAR, vz: 0.00002304172975737639 * DAYS_PER_YEAR, mass: 0.000285885980666130812 * SOLAR_MASS });
  bodies.push({ x: 12.89436956213913200, y: -15.11115140169863400, z: -0.22330757889265573, vx: 0.00296460137564761618 * DAYS_PER_YEAR, vy: 0.00237847173959480950 * DAYS_PER_YEAR, vz: -0.00029658956854023756 * DAYS_PER_YEAR, mass: 0.0000436624404335156298 * SOLAR_MASS });
  bodies.push({ x: 15.37969711485091650, y: -25.91931460998796400, z: 0.17925877295037118, vx: 0.00268067772490389322 * DAYS_PER_YEAR, vy: 0.00162824170038242295 * DAYS_PER_YEAR, vz: -0.00009515922545197159 * DAYS_PER_YEAR, mass: 0.0000515138902046611451 * SOLAR_MASS });

  let px = 0.0;
  let py = 0.0;
  let pz = 0.0;
  let i = 0;
  while (i < N_BODIES) {
    px = px + bodies[i].vx * bodies[i].mass;
    py = py + bodies[i].vy * bodies[i].mass;
    pz = pz + bodies[i].vz * bodies[i].mass;
    i = i + 1;
  }
  bodies[0].vx = 0.0 - px / SOLAR_MASS;
  bodies[0].vy = 0.0 - py / SOLAR_MASS;
  bodies[0].vz = 0.0 - pz / SOLAR_MASS;

  console.log("Energy:   " + energy(bodies));

  const start = Date.now();
  let step = 0;
  while (step < STEPS) {
    advance(bodies);
    step = step + 1;
  }
  const elapsed = (Date.now() - start) / 1000;

  console.log("Energy:   " + energy(bodies));
  console.log("Steps:    " + STEPS);
  console.log("Time:     " + elapsed + "s");
}

run();
