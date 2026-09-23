// A paused socket holding data nobody consumed never emits "end", so it never closes, and a server
// waiting for it never emits "close". It does not keep the process alive either: once the stream
// has ended the socket is idle, and the program exits as Node's does, without "server: closed".
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.on("end", () => console.log("unexpected: server socket end"));
  socket.end("bye");
});

server.listen(0, "127.0.0.1", () => {
  const client = net.connect({ port: server.address().port, host: "127.0.0.1" }, () => {
    client.write("data the server never reads");
  });
  let got = "";
  client.on("data", (chunk) => {
    got += chunk.toString();
  });
  client.on("close", () => {
    console.log("client: closed after receiving", JSON.stringify(got));
    server.close(() => console.log("unexpected: server: closed"));
  });
});
