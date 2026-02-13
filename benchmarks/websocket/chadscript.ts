interface WsEvent {
  data: string;
  event: string;
}

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface Response {
  status: number;
  body: string;
}

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsBroadcast(event.data);
    return "";
  }
  return "";
}

function handleRequest(req: Request): Response {
  return { status: 200, body: "WebSocket Benchmark Server" };
}

httpServe(9877, handleRequest, wsHandler);
