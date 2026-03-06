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

httpServe(9985, handleRequest);
