// @category: simulation
// Lotka-Volterra predator-prey dynamics integrated with Euler and RK4, comparing the two, finding
// population peaks, and writing a CSV time series.
import { writeFileSync } from "node:fs";

interface Params {
  alpha: number;
  beta: number;
  delta: number;
  gamma: number;
}

type State = [prey: number, predators: number];

function derivative([x, y]: State, p: Params): State {
  return [p.alpha * x - p.beta * x * y, p.delta * x * y - p.gamma * y];
}

function eulerStep(s: State, dt: number, p: Params): State {
  const [dx, dy] = derivative(s, p);
  return [s[0] + dx * dt, s[1] + dy * dt];
}

function rk4Step(s: State, dt: number, p: Params): State {
  const add = (a: State, b: State, k: number): State => [a[0] + b[0] * k, a[1] + b[1] * k];
  const k1 = derivative(s, p);
  const k2 = derivative(add(s, k1, dt / 2), p);
  const k3 = derivative(add(s, k2, dt / 2), p);
  const k4 = derivative(add(s, k3, dt), p);
  return [
    s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  ];
}

function simulate(
  step: (s: State, dt: number, p: Params) => State,
  p: Params,
  start: State,
  dt: number,
  steps: number,
): State[] {
  const out: State[] = [start];
  let s = start;
  for (let i = 0; i < steps; i++) {
    s = step(s, dt, p);
    out.push(s);
  }
  return out;
}

function peaks(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    if (series[i]! > series[i - 1]! && series[i]! >= series[i + 1]!) out.push(i);
  }
  return out;
}

const params: Params = { alpha: 1.1, beta: 0.4, delta: 0.1, gamma: 0.4 };
const dt = 0.01;
const steps = 3000;
const rk = simulate(rk4Step, params, [10, 10], dt, steps);
const eu = simulate(eulerStep, params, [10, 10], dt, steps);

const csv = ["t,prey,predators"];
for (let i = 0; i <= steps; i += 100) {
  const [x, y] = rk[i]!;
  csv.push(`${(i * dt).toFixed(2)},${x.toFixed(4)},${y.toFixed(4)}`);
}
writeFileSync("populations.csv", csv.join("\n") + "\n");
console.log(csv.slice(0, 8).join("\n"));

const preyPeaks = peaks(rk.map((s) => s[0]));
console.log(`prey peaks at t = ${preyPeaks.map((i) => (i * dt).toFixed(2)).join(", ")}`);
if (preyPeaks.length >= 2)
  console.log(`period ~ ${((preyPeaks[1]! - preyPeaks[0]!) * dt).toFixed(3)}`);
const final = rk[steps]!;
const drift = Math.hypot(eu[steps]![0] - final[0], eu[steps]![1] - final[1]);
console.log(
  `final rk4: prey=${final[0].toFixed(4)} predators=${final[1].toFixed(4)}; euler drift ${drift.toFixed(4)}`,
);
const invariant = (s: State): number =>
  params.delta * s[0] -
  params.gamma * Math.log(s[0]) +
  params.beta * s[1] -
  params.alpha * Math.log(s[1]);
console.log(
  `conserved quantity: start ${invariant(rk[0]!).toFixed(6)} end ${invariant(final).toFixed(6)}`,
);
