// @expect-reject: CS1232
// A named import is an alias of the async function; as a value it is rejected like a local one.
import { work } from "./lib";

const f = work;
f();
