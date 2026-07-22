interface Point {
  x: number;
  y: number;
}
const p: Point = { x: 1, y: 2 };
const p2: Point = { ...p, y: 20 };
console.log(p.x, p.y);
console.log(p2.x, p2.y);
const a = { name: "a", age: 1 };
const b = { age: 2, city: "nyc" };
const merged = { ...a, ...b };
console.log(merged.name, merged.age, merged.city);
interface Cfg {
  host: string;
  port: number;
  debug: boolean;
}
const defaults: Cfg = { host: "localhost", port: 80, debug: false };
const custom: Cfg = { ...defaults, port: 8080 };
console.log(custom.host, custom.port, custom.debug);
