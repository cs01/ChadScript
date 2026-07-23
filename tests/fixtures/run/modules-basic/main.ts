// Multi-file entry: `main.ts` in a fixture directory is one program with its siblings.
import { Circle, describe, ORIGIN } from "./shapes.ts";
import { scaled, SCALE } from "./util.ts";

const c = new Circle(2);
console.log(c.area());
console.log(ORIGIN, SCALE, scaled(21));
console.log(describe({ name: "point" }));

// An imported class works with the same machinery as a local one: methods, fields, instanceof.
const shapes = [new Circle(1), new Circle(3)];
console.log(shapes.map((s) => s.radius).join(","));
console.log(c instanceof Circle);
