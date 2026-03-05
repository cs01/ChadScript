// WebSocket Chat - real-time chat with embedded HTML/CSS served statically
import { ArgumentParser } from "chadscript/argparse";
import { httpServe, wsBroadcast, wsSend } from "chadscript/http";

const parser = new ArgumentParser("websocket-chat", "Real-time WebSocket chat server");
parser.addOption("port", "p", "Port to listen on", "8080");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

// Embed the public/ directory into the binary at compile time
ChadScript.embedDir("./public");

let userCount: number = 0;

function wsHandler(event: WsEvent): string {
  if (event.event === "open") {
    userCount = userCount + 1;
    console.log("  [ws] client connected (" + userCount + " online)");
    wsSend(event.connId, "init|" + event.connId);
    wsBroadcast("sys|a new user joined the chat (" + userCount + " online)");
    return "";
  }
  if (event.event === "close") {
    userCount = userCount - 1;
    console.log("  [ws] client disconnected (" + userCount + " online)");
    wsBroadcast("sys|a user left the chat (" + userCount + " online)");
    return "";
  }
  if (event.event === "message") {
    console.log("  [ws] message: " + event.data);
    wsBroadcast("msg|" + event.connId + "|" + event.data);
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

console.log("WebSocket Chat Server (HTML/CSS embedded at compile time)");
console.log("  open http://localhost:" + port + " in two tabs to chat");
httpServe(port, handleRequest, wsHandler);
