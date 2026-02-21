import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = parseInt(process.env.PORT || "3001", 10);

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket Echo Server");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    ws.send(data);
  });
});

server.listen(port, () => {
  console.log(`Node WebSocket echo server listening on port ${port}`);
});
