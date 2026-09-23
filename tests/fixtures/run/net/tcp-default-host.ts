// Without a host, a server listens on Node's default address (the IPv6 wildcard, which also
// accepts IPv4 on a dual-stack machine) and a client connects to "localhost". The address()
// fields and the exchange are printed; the port number itself is not, since it is picked by the
// kernel.
import * as net from "node:net";

const server = net.createServer((socket) => {
  socket.end("hello from the default address");
});

server.listen(0, () => {
  const info = server.address();
  console.log("address:", info.address);
  console.log("family:", info.family);
  const client = net.connect({ port: info.port }, () => {
    console.log("client connected via localhost");
  });
  let text = "";
  client.on("data", (chunk) => {
    text += chunk.toString();
  });
  client.on("end", () => {
    console.log("received:", text);
    server.close();
  });
});
