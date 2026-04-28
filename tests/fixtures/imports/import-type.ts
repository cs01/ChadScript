import type { Foo } from "./nonexistent-module.ts";

const x: number = 42;
console.log(x);
console.log("import type is stripped");
