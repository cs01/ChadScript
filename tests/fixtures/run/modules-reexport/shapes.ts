export class Square {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}

export function area(side: number): number {
  return new Square(side).area();
}

export function sideOf(s: Square): number {
  return s.side;
}
