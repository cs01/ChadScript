// @category: oop
// Immutable 2D vectors and polygons: arithmetic methods returning new instances, static
// constructors, equality with tolerance, polygon area/centroid/convex hull, and segment
// intersection.

class Vec2 {
  static readonly ZERO = new Vec2(0, 0);

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  static fromAngle(radians: number, length = 1): Vec2 {
    return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length);
  }

  add(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }
  sub(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }
  scale(k: number): Vec2 {
    return new Vec2(this.x * k, this.y * k);
  }
  dot(o: Vec2): number {
    return this.x * o.x + this.y * o.y;
  }
  cross(o: Vec2): number {
    return this.x * o.y - this.y * o.x;
  }
  get length(): number {
    return Math.hypot(this.x, this.y);
  }
  normalize(): Vec2 {
    const len = this.length;
    return len === 0 ? Vec2.ZERO : this.scale(1 / len);
  }
  rotate(radians: number): Vec2 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  equals(o: Vec2, eps = 1e-9): boolean {
    return Math.abs(this.x - o.x) < eps && Math.abs(this.y - o.y) < eps;
  }
  toString(): string {
    const f = (n: number): string =>
      Math.abs(n) < 1e-12 ? "0" : String(Math.round(n * 1000) / 1000);
    return `(${f(this.x)}, ${f(this.y)})`;
  }
}

class Polygon {
  constructor(readonly points: readonly Vec2[]) {
    if (points.length < 3) throw new Error("a polygon needs at least 3 points");
  }

  area(): number {
    let sum = 0;
    this.points.forEach((p, i) => {
      sum += p.cross(this.points[(i + 1) % this.points.length]!);
    });
    return Math.abs(sum) / 2;
  }

  centroid(): Vec2 {
    return this.points.reduce((acc, p) => acc.add(p), Vec2.ZERO).scale(1 / this.points.length);
  }

  perimeter(): number {
    return this.points.reduce(
      (acc, p, i) => acc + this.points[(i + 1) % this.points.length]!.sub(p).length,
      0,
    );
  }

  static convexHull(points: Vec2[]): Polygon {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const half = (list: Vec2[]): Vec2[] => {
      const out: Vec2[] = [];
      for (const p of list) {
        while (
          out.length >= 2 &&
          out[out.length - 1]!.sub(out[out.length - 2]!).cross(p.sub(out[out.length - 1]!)) <= 0
        )
          out.pop();
        out.push(p);
      }
      out.pop();
      return out;
    };
    return new Polygon([...half(pts), ...half([...pts].reverse())]);
  }
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = b.sub(a);
  const s = d.sub(c);
  const denom = r.cross(s);
  if (denom === 0) return null;
  const t = c.sub(a).cross(s) / denom;
  const u = c.sub(a).cross(r) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? a.add(r.scale(t)) : null;
}

const a = new Vec2(3, 4);
const b = new Vec2(-1, 2);
console.log(`${a} + ${b} = ${a.add(b)}, a-b = ${a.sub(b)}, |a| = ${a.length}`);
console.log(`dot ${a.dot(b)}, cross ${a.cross(b)}, unit ${a.normalize()}`);
console.log(
  `rotate 90: ${a.rotate(Math.PI / 2)}, fromAngle(45deg) ${Vec2.fromAngle(Math.PI / 4, Math.SQRT2)}`,
);
console.log(a.rotate(Math.PI * 2).equals(a), a.equals(b));

const square = new Polygon([new Vec2(0, 0), new Vec2(4, 0), new Vec2(4, 4), new Vec2(0, 4)]);
console.log(
  `square: area ${square.area()}, perimeter ${square.perimeter()}, centroid ${square.centroid()}`,
);
const cloud = [
  [0, 0],
  [2, 1],
  [4, 0],
  [3, 2],
  [4, 4],
  [2, 3],
  [0, 4],
  [1, 2],
  [2, 2],
].map(([x, y]) => new Vec2(x!, y!));
const hull = Polygon.convexHull(cloud);
console.log(`hull: ${hull.points.join(" ")} area ${hull.area()}`);
console.log(`${segmentsIntersect(new Vec2(0, 0), new Vec2(4, 4), new Vec2(0, 4), new Vec2(4, 0))}`);
console.log(`${segmentsIntersect(new Vec2(0, 0), new Vec2(1, 1), new Vec2(2, 0), new Vec2(3, 1))}`);
try {
  new Polygon([a, b]);
} catch (e) {
  console.log((e as Error).message);
}
