// WebSocket Chat - real-time chat with embedded HTML/CSS served statically
import { ArgumentParser } from "chadscript/argparse";
import { httpServe, wsBroadcast } from "chadscript/http";

const parser = new ArgumentParser("websocket-chat", "Real-time WebSocket chat server");
parser.addOption("port", "p", "Port to listen on (0 = auto)", "0");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

// Embed the public/ directory into the binary at compile time
ChadScript.embedDir("./public");

let userCount: number = 0;

function wsHandler(event: WsEvent): string {
  if (event.event === "open") {
    userCount = userCount + 1;
    console.log("  [ws] client connected (" + userCount + " online)");
    return "";
  }
  if (event.event === "close") {
    userCount = userCount - 1;
    console.log("  [ws] client disconnected (" + userCount + " online)");
    wsBroadcast("sys|a user left the chat (" + userCount + " online)");
    return "";
  }
  if (event.event === "message") {
    const sep = event.data.indexOf("|");
    const senderId = event.data.substring(0, sep);
    const text = event.data.substring(sep + 1);
    console.log("  [ws] " + senderId + ": " + text);
    wsBroadcast("msg|" + senderId + "|" + text);
    return "";
  }
  return "";
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path === "/") {
    return ChadScript.serveEmbedded("index.html");
  }
  return ChadScript.serveEmbedded(req.path);
}

console.log("WebSocket Chat Server (HTML/CSS embedded at compile time)");
httpServe(port, handleRequest, wsHandler);
