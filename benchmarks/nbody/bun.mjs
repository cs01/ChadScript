const PI = 3.141592653589793;
const SOLAR_MASS = 4.0 * PI * PI;
const DAYS_PER_YEAR = 365.24;
const N_BODIES = 5;
const STEPS = 50000000;
const DT = 0.01;

const bodies = [
  { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: SOLAR_MASS },
  { x: 4.84143144246472090e+00, y: -1.16032004402742839e+00, z: -1.03622044471123109e-01,
    vx: 1.66007664274403694e-03 * DAYS_PER_YEAR, vy: 7.69901118419740425e-03 * DAYS_PER_YEAR, vz: -6.90460016972020000e-05 * DAYS_PER_YEAR,
    mass: 9.54791938424326609e-04 * SOLAR_MASS },
  { x: 8.34336671824457987e+00, y: 4.12479856412430479e+00, z: -4.03603533096309840e-01,
    vx: -2.76742510726862411e-03 * DAYS_PER_YEAR, vy: 4.99852801234917238e-03 * DAYS_PER_YEAR, vz: 2.30417297573763890e-05 * DAYS_PER_YEAR,
    mass: 2.85885980666130812e-04 * SOLAR_MASS },
  { x: 1.28943695621391310e+01, y: -1.51111514016986340e+01, z: -2.23307578892655734e-01,
    vx: 2.96460137564761618e-03 * DAYS_PER_YEAR, vy: 2.37847173959480950e-03 * DAYS_PER_YEAR, vz: -2.96589568540237560e-04 * DAYS_PER_YEAR,
    mass: 4.36624404335156298e-05 * SOLAR_MASS },
  { x: 1.53796971148509165e+01, y: -2.59193146099879640e+01, z: 1.79258772950371181e-01,
    vx: 2.68067772490389322e-03 * DAYS_PER_YEAR, vy: 1.62824170038242295e-03 * DAYS_PER_YEAR, vz: -9.51592254519715870e-05 * DAYS_PER_YEAR,
    mass: 5.15138902046611451e-05 * SOLAR_MASS },
];

function advance() {
  for (let i = 0; i < N_BODIES; i++) {
    for (let j = i + 1; j < N_BODIES; j++) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const dz = bodies[i].z - bodies[j].z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(dist2);
      const mag = DT / (dist2 * dist);
      bodies[i].vx -= dx * bodies[j].mass * mag;
      bodies[i].vy -= dy * bodies[j].mass * mag;
      bodies[i].vz -= dz * bodies[j].mass * mag;
      bodies[j].vx += dx * bodies[i].mass * mag;
      bodies[j].vy += dy * bodies[i].mass * mag;
      bodies[j].vz += dz * bodies[i].mass * mag;
    }
  }
  for (let i = 0; i < N_BODIES; i++) {
    bodies[i].x += DT * bodies[i].vx;
    bodies[i].y += DT * bodies[i].vy;
    bodies[i].z += DT * bodies[i].vz;
  }
}

function energy() {
  let e = 0;
  for (let i = 0; i < N_BODIES; i++) {
    e += 0.5 * bodies[i].mass * (bodies[i].vx * bodies[i].vx + bodies[i].vy * bodies[i].vy + bodies[i].vz * bodies[i].vz);
    for (let j = i + 1; j < N_BODIES; j++) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const dz = bodies[i].z - bodies[j].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e -= bodies[i].mass * bodies[j].mass / dist;
    }
  }
  return e;
}

let px = 0, py = 0, pz = 0;
for (let i = 0; i < N_BODIES; i++) {
  px += bodies[i].vx * bodies[i].mass;
  py += bodies[i].vy * bodies[i].mass;
  pz += bodies[i].vz * bodies[i].mass;
}
bodies[0].vx = -px / SOLAR_MASS;
bodies[0].vy = -py / SOLAR_MASS;
bodies[0].vz = -pz / SOLAR_MASS;

console.log(`Energy:   ${energy()}`);

const start = performance.now();
for (let i = 0; i < STEPS; i++) {
  advance();
}
const elapsed = (performance.now() - start) / 1000;

console.log(`Energy:   ${energy()}`);
console.log(`Steps:    ${STEPS}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
