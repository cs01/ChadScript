interface WsEvent {
  data: string;
  event: string;
}

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    return event.data;
  }
  return "";
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

function handleRequest(req: Request): Response {
  return { status: 200, body: "WebSocket Echo Server" };
}

httpServe(3001, handleRequest, wsHandler);
