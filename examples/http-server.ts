// ChadScript HTTP Server - Express-like routing with HttpRequest/HttpResponse
import { ArgumentParser } from "../src/argparse.js";

const parser = new ArgumentParser("http-server", "HTTP server with Express-like routing");
parser.addOption("port", "p", "Port to listen on", "3000");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

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

// --- Route Handlers ---

function homeHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: '{"name":"ChadScript HTTP Server","status":"running"}' };
}

function jsonHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function echoHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: req.body };
}

function echoQueryHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: req.path.substring(10, req.path.length) };
}

function statusHandler(req: HttpRequest): HttpResponse {
  const code = req.path.substring(8, req.path.length);
  return { status: 200, body: "Status " + code };
}

function contentTypeHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: "Content-Type: " + req.contentType };
}

function errorHandler(req: HttpRequest): HttpResponse {
  return { status: 500, body: "Internal Server Error" };
}

function createdHandler(req: HttpRequest): HttpResponse {
  return { status: 201, body: "Resource Created" };
}

function notFoundHandler(req: HttpRequest): HttpResponse {
  return { status: 404, body: "Not Found" };
}

// --- Router ---

function handleRequest(req: HttpRequest): HttpResponse {
  console.log(req.method + " " + req.path);

  // GET routes
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
    if (req.path.startsWith("/echo?msg=")) return echoQueryHandler(req);
    if (req.path.startsWith("/status/")) return statusHandler(req);
    if (req.path == "/content-type") return contentTypeHandler(req);
    if (req.path == "/error") return errorHandler(req);
    if (req.path == "/created") return createdHandler(req);
  }

  // POST routes
  if (req.method == "POST") {
    if (req.path == "/echo") return echoHandler(req);
  }

  return notFoundHandler(req);
}

// --- Start Server ---

console.log("ChadScript HTTP Server");
console.log("  listening on http://localhost:" + port);
console.log("");
console.log("Available routes:");
console.log("  GET  /              - Server info (JSON)");
console.log("  GET  /json          - JSON response");
console.log("  GET  /echo?msg=...  - Echo query parameter");
console.log("  GET  /status/:code  - Status code demo");
console.log("  GET  /content-type  - Show request content type");
console.log("  GET  /error         - 500 error response");
console.log("  GET  /created       - 201 created response");
console.log("  POST /echo          - Echo request body");
console.log("");
console.log("Try it out:");
console.log("  curl http://localhost:" + port + "/");
console.log("  curl http://localhost:" + port + "/json");
console.log("  curl http://localhost:" + port + "/echo?msg=hello");
console.log("  curl -X POST -d 'hello world' http://localhost:" + port + "/echo");
console.log("");
httpServe(port, handleRequest);
