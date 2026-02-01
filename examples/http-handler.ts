// ChadScript HTTP Server Example
// Demonstrates Express-like routing with Request/Response interfaces

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

// --- Route Handlers ---

function homeHandler(req: Request): Response {
  return { status: 200, body: "Hello from ChadScript!" };
}

function jsonHandler(req: Request): Response {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function echoHandler(req: Request): Response {
  return { status: 200, body: req.body };
}

function echoQueryHandler(req: Request): Response {
  return { status: 200, body: req.path.substring(10, req.path.length) };
}

function statusHandler(req: Request): Response {
  const code = req.path.substring(8, req.path.length);
  return { status: 200, body: "Status " + code };
}

function contentTypeHandler(req: Request): Response {
  return { status: 200, body: "Content-Type: " + req.contentType };
}

function errorHandler(req: Request): Response {
  return { status: 500, body: "Internal Server Error" };
}

function createdHandler(req: Request): Response {
  return { status: 201, body: "Resource Created" };
}

function notFoundHandler(req: Request): Response {
  return { status: 404, body: "Not Found" };
}

// --- Router ---

function handleRequest(req: Request): Response {
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

const port = 3000;
console.log("ChadScript server starting on port " + port);
httpServe(port, handleRequest);
