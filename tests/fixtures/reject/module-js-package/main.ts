// @expect-reject: CS1226
// The package is plain JavaScript with no types at all: nothing for tsc to check or us to compile.
import { shout } from "js-only";

console.log(shout("hi"));
