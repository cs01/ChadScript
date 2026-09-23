export const A = 1;

export function add(a: number, b: number): number {
  return a + b;
}

export function double(n: number): number {
  return n * 2;
}

export function log(msg: string): void {
  console.log(`[lib] ${msg}`);
}

export class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  get(): number {
    return this.v + A;
  }
}

export interface Shape {
  w: number;
  h: number;
}

export function areaOf(s: Shape): number {
  return s.w * s.h;
}
