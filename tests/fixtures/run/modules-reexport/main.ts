// Re-exports: a barrel that forwards named, renamed and star exports. Every re-exported binding
// resolves (through tsc's alias chain) to the declaring module, which initializes first.
import { V, W, area, Square, sideOf } from "./barrel";

console.log(V, W, area(3));
const s = new Square(4);
console.log(sideOf(s), s.area(), s instanceof Square);
