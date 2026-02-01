// Simple HTTP server example
// Demonstrates native HTTP server compiled to a single binary

interface Response {
  status: number;
  body: string;
}

function handleRequest(method: string, path: string, body: string): Response {
  return { status: 200, body: "Hello from ChadScript HTTP Server!" };
}

// Start HTTP server on port 3000
const port = 3000;
console.log("Starting HTTP server...");
httpServe(port, handleRequest);
