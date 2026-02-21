import { createServer } from "node:http";

const port = parseInt(process.env.PORT || "3000", 10);

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello, World!");
}).listen(port, () => {
  console.log(`Node HTTP server listening on port ${port}`);
});
