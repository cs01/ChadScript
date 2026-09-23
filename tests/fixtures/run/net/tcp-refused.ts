// Connecting to a port nobody listens on: the socket emits "error" with Node's ECONNREFUSED error
// (code, message naming the address) and then "close" with hadError = true. The port is borrowed
// from a server that is closed first, so it is known to be free and the fixture needs no network.
import * as net from "node:net";

const probe = net.createServer(() => {});
probe.listen(0, "127.0.0.1", () => {
  const port = probe.address().port;
  probe.close(() => {
    const socket = net.connect({ port: port, host: "127.0.0.1" }, () => {
      console.log("unexpected: connected");
    });
    socket.on("error", (err) => {
      console.log("error code:", err.code);
      console.log("error name:", err.name);
      console.log("message matches:", err.message === "connect ECONNREFUSED 127.0.0.1:" + port);
      console.log("is an Error:", err instanceof Error);
    });
    socket.on("close", (hadError) => {
      console.log("closed, hadError =", hadError);
    });
  });
});
