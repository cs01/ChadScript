const PI = 3.141592653589793;
const SOLAR_MASS = 4.0 * PI * PI;
const DAYS_PER_YEAR = 365.24;
const N = 5;
const STEPS = 50000000;

const x: number[] = [];
const y: number[] = [];
const z: number[] = [];
const vx: number[] = [];
const vy: number[] = [];
const vz: number[] = [];
const mass: number[] = [];

x.push(0.0);
y.push(0.0);
z.push(0.0);
vx.push(0.0);
vy.push(0.0);
vz.push(0.0);
mass.push(SOLAR_MASS);

x.push(4.84143144246472090e+00);
y.push(-1.16032004402742839e+00);
z.push(-1.03622044471123109e-01);
vx.push(1.66007664274403694e-03 * DAYS_PER_YEAR);
vy.push(7.69901118419740425e-03 * DAYS_PER_YEAR);
vz.push(-6.90460016972063023e-05 * DAYS_PER_YEAR);
mass.push(9.54791938424326609e-04 * SOLAR_MASS);

x.push(8.34336671824457987e+00);
y.push(4.12479856412430479e+00);
z.push(-4.03523417114321381e-01);
vx.push(-2.76742510726862411e-03 * DAYS_PER_YEAR);
vy.push(4.99852801234917238e-03 * DAYS_PER_YEAR);
vz.push(2.30417297573763929e-05 * DAYS_PER_YEAR);
mass.push(2.85885980666130812e-04 * SOLAR_MASS);

x.push(1.28943695621391310e+01);
y.push(-1.51111514016986312e+01);
z.push(-2.23307578892655734e-01);
vx.push(2.96460137564761618e-03 * DAYS_PER_YEAR);
vy.push(2.37847173959480950e-03 * DAYS_PER_YEAR);
vz.push(-2.96589568540237556e-05 * DAYS_PER_YEAR);
mass.push(4.36624404335156298e-05 * SOLAR_MASS);

x.push(1.53796971148509165e+01);
y.push(-2.59193146099879641e+01);
z.push(1.79258772950371181e-01);
vx.push(2.68067772490389322e-03 * DAYS_PER_YEAR);
vy.push(1.62824170038242295e-03 * DAYS_PER_YEAR);
vz.push(-9.51592254519715870e-05 * DAYS_PER_YEAR);
mass.push(5.15138902046611451e-05 * SOLAR_MASS);

let px = 0.0;
let py = 0.0;
let pz = 0.0;
let i = 0;
while (i < N) {
  px = px + vx[i] * mass[i];
  py = py + vy[i] * mass[i];
  pz = pz + vz[i] * mass[i];
  i = i + 1;
}
vx[0] = -px / SOLAR_MASS;
vy[0] = -py / SOLAR_MASS;
vz[0] = -pz / SOLAR_MASS;

function energy(): number {
  let e = 0.0;
  let i = 0;
  while (i < N) {
    e = e + 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    let j = i + 1;
    while (j < N) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      const dz = z[i] - z[j];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e = e - (mass[i] * mass[j]) / dist;
      j = j + 1;
    }
    i = i + 1;
  }
  return e;
}

function advance(dt: number, steps: number): void {
  let s = 0;
  while (s < steps) {
    let i = 0;
    while (i < N) {
      let j = i + 1;
      while (j < N) {
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const dz = z[i] - z[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        const dist = Math.sqrt(d2);
        const mag = dt / (d2 * dist);
        vx[i] = vx[i] - dx * mass[j] * mag;
        vy[i] = vy[i] - dy * mass[j] * mag;
        vz[i] = vz[i] - dz * mass[j] * mag;
        vx[j] = vx[j] + dx * mass[i] * mag;
        vy[j] = vy[j] + dy * mass[i] * mag;
        vz[j] = vz[j] + dz * mass[i] * mag;
        j = j + 1;
      }
      i = i + 1;
    }
    i = 0;
    while (i < N) {
      x[i] = x[i] + dt * vx[i];
      y[i] = y[i] + dt * vy[i];
      z[i] = z[i] + dt * vz[i];
      i = i + 1;
    }
    s = s + 1;
  }
}

const start = Date.now();
advance(0.01, STEPS);
const end = Date.now();
const elapsed = (end - start) / 1000;

console.log("Bodies:   " + N);
console.log("Steps:    " + STEPS);
console.log("Energy:   " + energy());
console.log("Time:     " + elapsed + "s");
