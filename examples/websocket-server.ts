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
    wsBroadcast("someone said: " + event.data);
    return "echo: " + event.data;
  }
  return "";
}

function handleRequest(req: Request): Response {
  if (req.path == "/") {
    const html = "<!DOCTYPE html><html><body><h1>WebSocket Chat</h1><script>const ws=new WebSocket('ws://'+location.host+'/ws');ws.onmessage=e=>document.body.innerHTML+='<p>'+e.data+'</p>';document.onkeydown=e=>{if(e.key==='Enter'){ws.send(prompt('Message:'));}};</script></body></html>";
    return { status: 200, body: html };
  }
  return { status: 404, body: "Not Found" };
}

const port = 8080;
console.log("WebSocket Chat Server");
console.log("  Open http://localhost:" + port + "/ in your browser");
console.log("  Or use: websocat ws://localhost:" + port + "/ws");
httpServe(port, handleRequest, wsHandler);
