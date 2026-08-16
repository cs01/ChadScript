// @expect-reject: CS0001
// `sep` is a constant, not a call, and is deliberately outside this slice. The ambient
// `declare module "node:path"` is the allowlist, so an unlisted name fails the tsc gate.
import { sep } from "node:path";

console.log(sep);
