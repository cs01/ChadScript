// `import * as lib` lowers each `lib.x` to a static reference to x: no module object exists at
// runtime. Values, calls, classes (construct, instanceof, type position), functions as values.
import * as lib from "./lib";

console.log(lib.A, lib.add(2, 3));
const b: lib.Box = new lib.Box(7);
console.log(b.v, b instanceof lib.Box, b.get());
console.log([1, 2, 3].map(lib.double).join(","));
const shape: lib.Shape = { w: 2, h: 3 };
console.log(lib.areaOf(shape));
lib.log("statement position");
