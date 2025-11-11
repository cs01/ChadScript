// Request handler example - TypeScript structs compiled to native code
// Demonstrates type-safe request/response handling

interface Request {
  method: number;  // 0=GET, 1=POST, 2=PUT, 3=DELETE
  pathId: number;  // Route identifier
  bodyLength: number;
}

interface Response {
  status: number;
  contentLength: number;
}

function handleRequest(req: Request): Response {
  // GET requests
  if (req.method === 0) {
    if (req.pathId === 1) {  // Route: /
      return { status: 200, contentLength: 24 };  // "Welcome to ChadScript!"
    }
    if (req.pathId === 2) {  // Route: /hello
      return { status: 200, contentLength: 13 };  // "Hello, World!"
    }
    if (req.pathId === 3) {  // Route: /about
      return { status: 200, contentLength: 23 };  // "ChadScript AOT Compiler"
    }

    // 404 Not Found
    return { status: 404, contentLength: 9 };
  }

  // POST requests
  if (req.method === 1) {
    if (req.pathId === 10) {  // Route: /echo
      return { status: 200, contentLength: req.bodyLength };
    }

    if (req.pathId === 11) {  // Route: /submit
      return { status: 201, contentLength: 7 };  // "Created"
    }
  }

  // 405 Method Not Allowed
  return { status: 405, contentLength: 18 };
}

// Simulate handling various requests
function processRequests(): number {
  let totalResponses = 0;

  // GET /
  const req1 = { method: 0, pathId: 1, bodyLength: 0 };
  const resp1 = handleRequest(req1);
  console.log(resp1.status);
  totalResponses = totalResponses + 1;

  // GET /hello
  const req2 = { method: 0, pathId: 2, bodyLength: 0 };
  const resp2 = handleRequest(req2);
  console.log(resp2.status);
  totalResponses = totalResponses + 1;

  // GET /notfound
  const req3 = { method: 0, pathId: 999, bodyLength: 0 };
  const resp3 = handleRequest(req3);
  console.log(resp3.status);
  totalResponses = totalResponses + 1;

  // POST /echo
  const req4 = { method: 1, pathId: 10, bodyLength: 12 };
  const resp4 = handleRequest(req4);
  console.log(resp4.status);
  totalResponses = totalResponses + 1;

  return totalResponses;
}

processRequests();
