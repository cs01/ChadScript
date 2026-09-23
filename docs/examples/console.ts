// console.log prints values the way Node's util.inspect does, and honors format directives.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

console.log(1 / 3, -0, 1e21, NaN, "text", true, null, undefined);
console.log([1, "two", [3, 4]], { name: "ada", tags: ["x"], nested: { depth: 2 } });
console.log(new Point(1, 2), [new Point(3, 4)]);
const m = new Map<string, number>();
m.set("a", 1);
console.log(m, new Set<number>([1, 2]));
console.log("%s scored %d (%i%%)", "ada", 9.5, 95.4);
console.log(`template ${[1, 2].join("+")} ${-0} ${0.1 + 0.2}`);
