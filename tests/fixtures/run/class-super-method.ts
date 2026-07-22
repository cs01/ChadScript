class Shape {
  sides: number;
  constructor(s: number) {
    this.sides = s;
  }
  kind(): string {
    return "shape with " + this.sides + " sides";
  }
}
class Square extends Shape {
  label: string;
  constructor(l: string) {
    super(4);
    this.label = l;
  }
  full(): string {
    return super.kind() + " named " + this.label;
  }
}
console.log(new Square("box").full());
const shapes: Shape[] = [new Shape(3), new Square("s")];
for (const s of shapes) {
  console.log(s.kind());
}
