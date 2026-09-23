// An "error" event with no listener is thrown, as in Node: the process ends with exit code 1, the
// error is reported on stderr, and nothing after the failed connection runs. Port 1 on the
// loopback address is a port nothing listens on, and a fixed port keeps the reported message
// identical between runs.
import * as net from "node:net";

console.log("connecting to a port nobody listens on");
const socket = net.connect({ port: 1, host: "127.0.0.1" });
socket.on("close", () => {
  console.log("unexpected: close ran after an unhandled error");
});
setTimeout(() => console.log("unexpected: timer ran"), 500);
