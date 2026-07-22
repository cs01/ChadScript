class Rect {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h;
  }
  perimeter(): number {
    return 2 * (this.w + this.h);
  }
  scale(f: number): void {
    this.w = this.w * f;
    this.h = this.h * f;
  }
}
const r = new Rect(3, 4);
console.log(r.area(), r.perimeter());
r.scale(2);
console.log(r.area(), r.perimeter());
