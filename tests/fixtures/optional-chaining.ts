class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

class Box {
  label: string;
  value: number;
  constructor(label: string, value: number) {
    this.label = label;
    this.value = value;
  }
}

const p: Point = new Point(3, 4);
console.log(p?.x);
console.log(p?.y);
console.log(p?.sum());

const b: Box = new Box("test", 42);
console.log(b?.label);
console.log(b?.value);

function maybePoint(flag: boolean): Point | null {
  if (flag) {
    return new Point(10, 20);
  }
  return null;
}

const p1: Point | null = maybePoint(true);
const p2: Point | null = maybePoint(false);

console.log(p1?.x);
console.log(p1?.sum());

const v1: number = p1?.y;
const v2: number = p2?.y;
if (v1 > 0) {
  console.log("p1 has y");
}
if (v2 > 0) {
  console.log("p2 has y");
} else {
  console.log("p2 no y");
}
