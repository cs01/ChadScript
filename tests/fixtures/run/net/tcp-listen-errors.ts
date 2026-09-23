// Listening on a port another server holds fails with Node's EADDRINUSE error, delivered as an
// "error" event (not a throw from listen()). Reading address() of a server that is not listening
// throws the TypeError Node throws for reading a field of null.
import * as net from "node:net";

const first = net.createServer(() => {});
first.listen(0, "127.0.0.1", () => {
  const port = first.address().port;
  const second = net.createServer(() => {});
  second.on("error", (err) => {
    console.log("code:", err.code);
    console.log("message:", err.message.replace(String(port), "PORT"));
    try {
      console.log(second.address().port);
    } catch (e) {
      console.log("address() of a failed server:", String(e));
    }
    first.close(() => console.log("first closed"));
  });
  second.listen(port, "127.0.0.1", () => {
    console.log("unexpected: second server listening");
  });
});
