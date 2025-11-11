// Simple request router - demonstrates TypeScript struct usage
// Note: No actual HTTP - just routing logic compiled to native code

interface Request {
  method: string;
  path: string;
  body: string;
}

interface Response {
  status: number;
  body: string;
}

function handleRequest(req: Request): Response {
  // Route: GET /
  if (req.method === "GET") {
    if (req.path === "/") {
      return { status: 200, body: "Welcome to ChadScript!" };
    }

    if (req.path === "/hello") {
      return { status: 200, body: "Hello, World!" };
    }

    if (req.path === "/about") {
      return { status: 200, body: "ChadScript AOT Compiler" };
    }

    // 404 Not Found
    return { status: 404, body: "Not Found" };
  }

  // Route: POST /echo
  if (req.method === "POST") {
    if (req.path === "/echo") {
      return { status: 200, body: req.body };
    }
  }

  // 405 Method Not Allowed
  return { status: 405, body: "Method Not Allowed" };
}

// Demonstration - shows routing logic compiles to native code
// In a real scenario, you'd read from stdin/socket and write responses

function testRouter(): number {
  const req1 = { method: "GET", path: "/", body: "" };
  handleRequest(req1);

  const req2 = { method: "GET", path: "/hello", body: "" };
  handleRequest(req2);

  const req3 = { method: "GET", path: "/unknown", body: "" };
  handleRequest(req3);

  const req4 = { method: "POST", path: "/echo", body: "Test message" };
  handleRequest(req4);

  return 0;
}

testRouter();
