// @expect-reject: CS1249
// A listener parameter declared wider than what the event passes (a Buffer) in a way no conversion
// reaches: the runtime passes a bare handle, never an optional one.
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.on("data", (chunk: Buffer | undefined) => {
    console.log(chunk === undefined ? "none" : chunk.toString());
  });
});
server.close();
