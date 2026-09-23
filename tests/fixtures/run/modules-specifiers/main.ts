// Specifiers as TypeScript writes them. tsc resolves every one (moduleResolution: bundler), and
// the oracle runs the same source through tsx, which resolves them the same way.
import { x } from "./lib.js";
import { twice } from "./math";
import { EXACT } from "./exact.ts";
import { fromDir } from "./dir";
import { fromIndex } from "./nested/index";
import { upward } from "./nested/up";

console.log(x, twice(4), EXACT, fromDir(), fromIndex(), upward());
