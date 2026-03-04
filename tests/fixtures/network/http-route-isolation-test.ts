// @test-skip
// HTTP route isolation fixture used by http-routes.test.ts (needs external test orchestration)
import { httpServe } from "chadscript/http";

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
}

interface Response {
  status: number;
  body: string;
  headers: string;
}

function homeHandler(req: Request): Response {
  return { status: 200, body: "Hello from ChadScript!", headers: "" };
}

function jsonHandler(req: Request): Response {
  return { status: 200, body: '{"message":"hello","count":42}', headers: "" };
}

function echoHandler(req: Request): Response {
  return { status: 200, body: req.body, headers: "" };
}

function echoQueryHandler(req: Request): Response {
  return { status: 200, body: req.path.substring(10, req.path.length), headers: "" };
}

function statusHandler(req: Request): Response {
  return { status: 200, body: "Status " + req.path.substring(8, req.path.length), headers: "" };
}

function contentTypeHandler(req: Request): Response {
  return { status: 200, body: "Content-Type: " + req.contentType, headers: "" };
}

function errorHandler(req: Request): Response {
  return { status: 500, body: "Internal Server Error", headers: "" };
}

function createdHandler(req: Request): Response {
  return { status: 201, body: "Resource Created", headers: "" };
}

function largeHandler(req: Request): Response {
  let body = "<html><head><title>Large Response</title></head><body>";
  body = body + "<h1>This is a large response for compression testing</h1>";
  body =
    body +
    "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>";
  body =
    body +
    "<p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>";
  body =
    body +
    "<p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>";
  return { status: 200, body: body, headers: "" };
}

function notFoundHandler(req: Request): Response {
  return { status: 404, body: "Not Found", headers: "" };
}

function handleRequest(req: Request): Response {
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
    if (req.path.startsWith("/echo?msg=")) return echoQueryHandler(req);
    if (req.path.startsWith("/status/")) return statusHandler(req);
    if (req.path == "/content-type") return contentTypeHandler(req);
    if (req.path == "/large") return largeHandler(req);
    if (req.path == "/error") return errorHandler(req);
    if (req.path == "/created") return createdHandler(req);
  }

  if (req.method == "POST") {
    if (req.path == "/echo") return echoHandler(req);
  }

  return notFoundHandler(req);
}

httpServe(9987, handleRequest);
