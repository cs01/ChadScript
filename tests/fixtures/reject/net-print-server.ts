// @expect-reject: CS1234
// Node prints a Server as an object full of internal fields, which a compiled program cannot
// reproduce.
import * as net from "node:net";

const server = net.createServer(() => {});
console.log(server);
