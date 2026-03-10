// @test-skip
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

function getPortNum(): number {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return parseInt(args[i + 1]);
    }
  }
  return 9997;
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

const port = getPortNum();
httpServe(port, handleRequest);
