import http from "http";

const server = http.createServer((req: any, res: any) => {
  const method: string = req.method;
  const url: string = req.url;

  if (url === "/" && method === "GET") {
    res.writeHead(200, "text/html");
    res.end("<h1>Welcome to ChadScript!</h1><p>Compiled to native binary.</p>");
  } else if (url === "/api/hello" && method === "GET") {
    res.writeHead(200, "application/json");
    res.end("{\"message\": \"hello from chadscript\", \"compiled\": true}");
  } else if (url === "/api/time" && method === "GET") {
    res.writeHead(200, "application/json");
    res.end("{\"status\": \"ok\"}");
  } else {
    res.writeHead(404, "text/plain");
    res.end("not found");
  }
});

server.listen(3456, () => {
  console.log("ChadScript server running on http://localhost:3456");
});
