// `import type` is erased, so Node never loads `./types` and its top-level log never runs; the
// compiler must not initialize it either. A mixed `import { type X, y }` still loads its module.
import type { Shape } from "./types";
import { type Named, describe } from "./named";

const s: Shape = { w: 2, h: 5 };
const n: Named = { name: "box" };
console.log(s.w * s.h, describe(n));
