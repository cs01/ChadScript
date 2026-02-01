// ChadScript HTTP Server Test Program
// This program tests HTTP server functionality compiled to native code

interface Response {
  status: number;
  body: string;
}

function handleRequest(method: string, path: string, body: string): Response {
  if (path == "/") {
    return { status: 200, body: "Hello from ChadScript!" };
  }

  if (path.startsWith("/echo?msg=")) {
    return { status: 200, body: path.substring(10, path.length) };
  }

  if (path == "/json") {
    return { status: 200, body: '{"message":"hello","count":42}' };
  }

  if (path.startsWith("/status/")) {
    const code = path.substring(8, path.length);
    return { status: 200, body: "Status " + code };
  }

  if (method == "POST" && path == "/echo") {
    return { status: 200, body: body };
  }

  if (path == "/error") {
    return { status: 500, body: "Internal Server Error" };
  }

  if (path == "/created") {
    return { status: 201, body: "Resource Created" };
  }

  return { status: 404, body: "Not Found" };
}

const port = 3000;
console.log("ChadScript server starting on port " + port);
httpServe(port, handleRequest);
