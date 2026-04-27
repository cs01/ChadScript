import { Greeter, makeGreeter } from "./greeter.ts";

const g = new Greeter("world");
console.log(g.greet());

const g2 = makeGreeter("chad");
console.log(g2.greet());
