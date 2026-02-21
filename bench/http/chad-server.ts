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
  return { status: 200, body: "Hello, World!" };
}

httpServe(3000, handleRequest);
