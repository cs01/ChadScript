import { resolve, isAbsolute } from "node:path";

// resolve() consults the cwd, so absolute output is machine-specific. The oracle and the native
// binary run from the SAME cwd, which is what makes the comparison meaningful; the assertions
// below additionally pin the parts that must hold on any machine.
console.log(resolve("/a", "/b"));
console.log(resolve("/a", "b", "c"));
console.log(resolve("/a/b", "../c"));
console.log(resolve("/"));
console.log(resolve("/a", "", "b"));
console.log(isAbsolute(resolve("relative")));
console.log(isAbsolute(resolve()));
console.log(resolve("/x/y", "..", "z"));
