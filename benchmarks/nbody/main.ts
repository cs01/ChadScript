// N-body: classes, field mutation through references, f64 math (sqrt-heavy).
class Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  constructor(x: number, y: number, vx: number, vy: number, mass: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.mass = mass;
  }
}

function step(bodies: Body[], dt: number): void {
  for (const a of bodies) {
    for (const b of bodies) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const inv = 1 / (d2 * Math.sqrt(d2));
      a.vx += dx * b.mass * inv * dt;
      a.vy += dy * b.mass * inv * dt;
    }
  }
  for (const a of bodies) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
  }
}

function run(count: number, steps: number): number {
  const bodies: Body[] = [];
  for (let i = 0; i < count; i++) {
    const f = i + 1;
    bodies.push(new Body(f % 17, f % 23, 0, 0, 1 + (f % 3)));
  }
  for (let s = 0; s < steps; s++) step(bodies, 0.01);
  let energy = 0;
  for (const b of bodies) energy += b.vx * b.vx + b.vy * b.vy;
  return energy;
}

console.log(run(600, 60));
