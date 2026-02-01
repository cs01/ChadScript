// ChadScript HTTP Server Test Program
// This program tests HTTP server functionality compiled to native code

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
  if (req.path == "/") {
    return { status: 200, body: "Hello from ChadScript!" };
  }

  if (req.path.startsWith("/echo?msg=")) {
    return { status: 200, body: req.path.substring(10, req.path.length) };
  }

  if (req.path == "/json") {
    return { status: 200, body: '{"message":"hello","count":42}' };
  }

  if (req.path.startsWith("/status/")) {
    const code = req.path.substring(8, req.path.length);
    return { status: 200, body: "Status " + code };
  }

  if (req.method == "POST" && req.path == "/echo") {
    return { status: 200, body: req.body };
  }

  if (req.path == "/content-type") {
    return { status: 200, body: "Content-Type: " + req.contentType };
  }

  if (req.path == "/error") {
    return { status: 500, body: "Internal Server Error" };
  }

  if (req.path == "/created") {
    return { status: 201, body: "Resource Created" };
  }

  return { status: 404, body: "Not Found" };
}

const port = 3000;
console.log("ChadScript server starting on port " + port);
httpServe(port, handleRequest);
