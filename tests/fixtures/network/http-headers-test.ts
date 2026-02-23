// @test-skip
// HTTP headers fixture used by http-headers.test.ts (needs external test orchestration)
// Tests: custom response headers, Content-Type override, request header access

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
  // /custom-ct — override Content-Type via headers field
  if (req.path == "/custom-ct") {
    return {
      status: 200,
      body: '{"data":true}',
      headers: "Content-Type: application/json",
    };
  }

  // /set-cookie — send a Set-Cookie header
  if (req.path == "/set-cookie") {
    return {
      status: 200,
      body: "cookie set",
      headers: "Set-Cookie: session=abc123; Path=/",
    };
  }

  // /multi-header — multiple custom headers
  if (req.path == "/multi-header") {
    return {
      status: 200,
      body: "multi",
      headers: "X-Custom: hello\nX-Another: world",
    };
  }

  // /echo-headers — echo back request headers
  if (req.path == "/echo-headers") {
    return { status: 200, body: req.headers, headers: "" };
  }

  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(9986, handleRequest);
