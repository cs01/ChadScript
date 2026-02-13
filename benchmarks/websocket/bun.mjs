Bun.serve({
  port: 9877,
  websocket: {
    open(ws) {
      ws.subscribe("room");
    },
    message(ws, msg) {
      ws.publishText("room", msg.toString());
    },
    close(ws) {},
    publishToSelf: true,
  },
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("WebSocket Benchmark Server");
  },
});

console.log("Bun WS listening on 9877");
