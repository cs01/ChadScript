// ChadScript HTTP Server Test Program
// This program tests HTTP server functionality compiled to native code

function handleRequest(method: string, path: string): string {
  if (path == "/") {
    return "Hello from ChadScript!";
  }

  if (path.startsWith("/echo?msg=")) {
    return path.substring(10, path.length);
  }

  if (path == "/json") {
    return '{"message":"hello","count":42}';
  }

  if (path.startsWith("/status/")) {
    const code = path.substring(8, path.length);
    return "Status " + code;
  }

  return "Not Found";
}

const port = 3000;
console.log("ChadScript server starting on port " + port);
httpServe(port, handleRequest);
