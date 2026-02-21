const port = parseInt(process.env.PORT || "3001", 10);

Bun.serve({
  port,
  websocket: {
    open(ws) {},
    message(ws, msg) {
      ws.send(msg);
    },
    close(ws) {},
    perMessageDeflate: false,
  },
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("WebSocket Echo Server");
  },
});

console.log(`Bun WebSocket echo server listening on port ${port}`);
