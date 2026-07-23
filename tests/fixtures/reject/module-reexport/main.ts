// @expect-reject: CS1226
// A re-export makes a module's bindings depend on a file it does not itself initialize.
export { V } from "./inner.ts";
console.log(1);
