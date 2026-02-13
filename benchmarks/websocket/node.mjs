import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("WebSocket Benchmark Server");
});

const wss = new WebSocketServer({ server });
const clients = [];

wss.on("connection", (ws) => {
  clients.push(ws);

  ws.on("message", (message) => {
    const out = message.toString();
    for (let i = 0; i < clients.length; i++) {
      clients[i].send(out);
    }
  });

  ws.on("close", () => {
    const idx = clients.indexOf(ws);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

server.listen(9877, () => console.log("Node WS listening on 9877"));
