// A listener may be an async function: the runtime calls it like any other listener and ignores
// the promise it returns, as Node's event emitter does. Its awaits interleave with the socket's
// later events exactly as they do in Node.
import * as net from "node:net";

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

const server = net.createServer((socket) => {
  socket.on("data", async (chunk) => {
    const text = chunk.toString();
    await delay(5);
    socket.end("processed " + text);
  });
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  await delay(1);
  console.log("connecting after an await");
  const client = net.connect({ port: port, host: "127.0.0.1" }, () => {
    client.write("job-1");
  });
  let reply = "";
  client.on("data", (chunk) => {
    reply += chunk.toString();
  });
  client.on("close", () => {
    console.log("reply:", reply);
    server.close();
  });
});
