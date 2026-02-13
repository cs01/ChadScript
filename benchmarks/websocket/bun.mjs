Bun.serve({
  port: 9877,
  websocket: {
    message(ws, msg) {
      ws.send(msg);
    },
    close(ws) {},
  },
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("WebSocket Benchmark Server");
  },
});

console.log("Bun WS listening on 9877");
