// A TCP echo server on an ephemeral port and one client talking to it. Every line printed is
// causally ordered (each event waits on the previous one's effect), so the transcript is the same
// on every run; the process exits on its own once both sockets and the server are closed.
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    socket.write(chunk.toString());
  });
  socket.on("end", () => {
    console.log("server: client ended");
  });
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log("listening on a port:", port > 0);
  const client = net.connect({ port: port, host: "127.0.0.1" }, () => {
    console.log("client: connected");
    client.write("hello, echo");
  });
  let received = "";
  client.on("data", (chunk) => {
    received += chunk.toString();
    if (received === "hello, echo") {
      console.log("client: got", received);
      client.end();
    }
  });
  client.on("close", (hadError) => {
    console.log("client: closed, hadError =", hadError);
    server.close(() => {
      console.log("server: closed");
    });
  });
});
