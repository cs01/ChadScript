import http from "http";

const server = http.createServer((req: any, res: any) => {
  const url: string = req.url;
  const check: string = "/";
  const eq: boolean = url === check;
  res.writeHead(200, "text/plain");
  if (eq) {
    res.end("matched root");
  } else {
    res.end("no match url=[" + url + "] check=[" + check + "] eq=" + eq);
  }
});

server.listen(3457, () => {
  console.log("up");
});
