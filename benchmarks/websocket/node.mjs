import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("WebSocket Benchmark Server");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    ws.send(message);
  });
});

server.listen(9877, () => console.log("Node WS listening on 9877"));
