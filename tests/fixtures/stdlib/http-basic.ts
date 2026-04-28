import http from "http";

const server = http.createServer((req: any, res: any) => {
  res.writeHead(200, "text/plain");
  res.end("ok");
});

console.log("server created");

server.listen(18234, () => {
  console.log("listening on 18234");
  server.close();
});
