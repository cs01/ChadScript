export class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  describe(): string {
    return `other point ${this.x}`;
  }
}

export function makePoint(x: number): Point {
  return new Point(x);
}

export function helper(): string {
  return "other helper";
}

export const label = "other";

export function isOtherPoint(p: Point): boolean {
  return p instanceof Point;
}
