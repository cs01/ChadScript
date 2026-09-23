// Named, default and namespace imports; a re-export; type-only imports.
import { area, type Shape } from "./geometry.js";
import describe from "./describe";
import * as units from "./units";

const shapes: Shape[] = [
  { kind: "circle", size: 1 },
  { kind: "square", size: 3 },
];
for (const s of shapes) {
  console.log(describe(s), units.format(area(s), units.SQUARE_METERS));
}
