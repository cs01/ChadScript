// Half-close: the client sends its whole request and then ends its side (FIN). The server only
// answers once it has seen the end of the request, from inside its "end" listener, which Node
// allows because the socket's writable side is still open at that point. The client then sees the
// reply, the server's end, and the close, in that order.
import * as net from "node:net";

// Server-side events are collected and printed at the end: the server's "close" and the client's
// "end" happen on different sockets, so printing them as they happen would race.
const serverLog: string[] = [];
const server = net.createServer((socket) => {
  let request = "";
  socket.on("data", (chunk) => {
    request += chunk.toString();
  });
  socket.on("end", () => {
    serverLog.push("request complete: " + request);
    socket.end("reply to " + request);
  });
  socket.on("close", (hadError) => {
    serverLog.push("socket closed, hadError = " + hadError);
  });
});

server.listen(0, "127.0.0.1", () => {
  const client = net.createConnection({ port: server.address().port, host: "127.0.0.1" });
  client.on("connect", () => {
    client.write("part one, ");
    client.end("part two");
  });
  let reply = "";
  client.on("data", (chunk) => {
    reply += chunk.toString();
  });
  client.on("end", () => {
    console.log("client: reply:", reply);
  });
  client.on("close", () => {
    console.log("client: closed");
    server.close(() => {
      for (const line of serverLog) console.log("server:", line);
    });
  });
});
