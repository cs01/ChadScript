// @test-skip
// HTTP server fixture used by network.test.ts (needs external test orchestration)

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface Response {
  status: number;
  body: string;
}

function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "Hello from ChadScript!" };
  }
  if (req.path == "/json") {
    return { status: 200, body: '{"ok":true}' };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(9997, handleRequest);
