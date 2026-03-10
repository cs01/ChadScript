// @test-skip
// HTTP query string fixture used by http-query-string.test.ts
import { httpServe } from "chadscript/http";

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
  bodyLen: number;
  queryString: string;
}

interface Response {
  status: number;
  body: string;
  headers: string;
}

function handleRequest(req: Request): Response {
  if (req.path == "/echo-query") {
    return { status: 200, body: req.queryString, headers: "" };
  }
  if (req.path == "/check-path") {
    return { status: 200, body: req.path, headers: "" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}

function getPortNum(): number {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return parseInt(args[i + 1]);
    }
  }
  return 9985;
}

const port = getPortNum();
httpServe(port, handleRequest);
