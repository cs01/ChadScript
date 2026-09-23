// @expect-reject: CS1249
// Connection options must be an object literal, so the port and host are visible to the compiler.
import * as net from "node:net";

const options: net.ConnectOptions = { port: 8080, host: "127.0.0.1" };
const socket = net.connect(options);
socket.on("error", () => {});
