export class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

export function makePoint(x: number): Point {
  return new Point(x);
}
