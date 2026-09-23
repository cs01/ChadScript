// Calls through an interface reach class methods (with inheritance and overrides) and
// function-valued fields of literals alike; results, void calls and arguments all flow through.
// Printing such an object shows its function fields the way Node names them.
interface Shape {
  area(scale: number): number;
  describe(): string;
}
class Rect implements Shape {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  area(scale: number): number {
    return this.w * this.h * scale;
  }
  describe(): string {
    return "rect " + this.area(1);
  }
}
class Square extends Rect {
  constructor(s: number) {
    super(s, s);
  }
  override describe(): string {
    return "square " + this.area(1);
  }
}
const circle: Shape = {
  area: (scale: number): number => 3 * scale,
  describe: (): string => "circle",
};
const shapes: Shape[] = [new Rect(2, 3), new Square(4), circle];
for (const s of shapes) console.log(s.describe(), s.area(2));

interface Logger {
  log(msg: string): void;
}
class Prefixed implements Logger {
  prefix: string;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  log(msg: string): void {
    console.log(this.prefix + msg);
  }
}
const plain: Logger = { log: (msg: string): void => console.log("plain " + msg) };
for (const l of [new Prefixed("> "), plain]) l.log("hi");
console.log(circle);
const named = (): string => "n";
console.log({ named, anon: [(x: number): number => x][0] });
