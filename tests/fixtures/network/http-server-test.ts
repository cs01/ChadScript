// @test-skip
// HTTP server fixture used by network.test.ts (needs external test orchestration)
import { httpServe } from "chadscript/http";

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
}

interface Response {
  status: number;
  body: string;
  headers: string;
}

function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "Hello from ChadScript!", headers: "" };
  }
  if (req.path == "/json") {
    return { status: 200, body: '{"ok":true}', headers: "" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(9997, handleRequest);
