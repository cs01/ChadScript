// A socket nobody reads (no "data" listener) still reads in the background, as Node's paused mode
// does. When the peer sent nothing, the end of the stream is still seen and "end" and "close" are
// emitted; the server-side events here are causally ordered, so they print as they happen.
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.on("end", () => console.log("server socket: end (never read, peer sent nothing)"));
  socket.on("close", () => {
    console.log("server socket: close");
    server.close(() => console.log("server: closed"));
  });
  socket.end("bye");
});

server.listen(0, "127.0.0.1", () => {
  const client = net.connect({ port: server.address().port, host: "127.0.0.1" });
  client.on("data", () => {});
});
