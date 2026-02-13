interface WsEvent {
  data: string;
  event: string;
}

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    return "echo: " + event.data;
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
  return { status: 200, body: "hello" };
}

console.log("ws-server-basic: compile test");
console.log("TEST_PASSED");
