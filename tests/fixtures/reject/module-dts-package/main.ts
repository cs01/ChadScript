// @expect-reject: CS1226
// The package ships compiled JavaScript plus a `.d.ts`: there is no TypeScript source to compile.
import { shout } from "typed-only";

console.log(shout("hi"));
