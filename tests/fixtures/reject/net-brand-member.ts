// @expect-reject: CS1234
// The brand member that keeps look-alike objects out is not part of the API.
import * as net from "node:net";

const server = net.createServer(() => {});
const brand = server.__opaqueServer;
server.close();
