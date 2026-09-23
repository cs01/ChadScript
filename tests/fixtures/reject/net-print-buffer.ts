// @expect-reject: CS1234
// Node prints a Buffer as its raw bytes (`<Buffer 68 69>`); convert it with toString() first.
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.on("data", (chunk) => {
    console.log(chunk);
  });
});
server.close();
