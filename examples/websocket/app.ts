// WebSocket Chat - real-time chat with embedded HTML/CSS served statically
import { ArgumentParser } from "../../src/argparse.js";

const parser = new ArgumentParser("websocket-chat", "Real-time WebSocket chat server");
parser.addOption("port", "p", "Port to listen on", "8080");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

interface WsEvent {
  data: string;
  event: string;
}

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

// Embed the public/ directory into the binary at compile time
ChadScript.embedDir("./public");

let userCount: number = 0;

function wsHandler(event: WsEvent): string {
  if (event.event === "open") {
    userCount = userCount + 1;
    console.log("  [ws] client connected (" + userCount + " online)");
    wsBroadcast("a new user joined the chat (" + userCount + " online)");
    return "";
  }
  if (event.event === "close") {
    userCount = userCount - 1;
    console.log("  [ws] client disconnected (" + userCount + " online)");
    wsBroadcast("a user left the chat (" + userCount + " online)");
    return "";
  }
  if (event.event === "message") {
    console.log("  [ws] message: " + event.data);
    wsBroadcast(event.data);
    return "";
  }
  return "";
}

function handleRequest(req: HttpRequest): HttpResponse {
  console.log(req.method + " " + req.path);

  // Serve index.html for the root path
  if (req.path === "/") {
    return ChadScript.serveEmbedded("index.html");
  }

  // serveEmbedded strips leading "/" and looks up embedded files automatically.
  // Returns 200 with content if found, 404 if not.
  return ChadScript.serveEmbedded(req.path);
}

console.log("WebSocket Chat Server");
console.log("  listening on http://localhost:" + port);
console.log("  HTML/CSS embedded in the binary at compile time");
console.log("");
console.log("Open http://localhost:" + port + " in your browser to start chatting");
console.log("Or connect via CLI: websocat ws://localhost:" + port + "/ws");
console.log("");
httpServe(port, handleRequest, wsHandler);
