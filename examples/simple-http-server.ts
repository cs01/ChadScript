// Simple HTTP server example
// Demonstrates native HTTP server compiled to a single binary

function handleRequest(method: string, path: string): string {
  // For now, return a fixed response
  // (String comparison not yet fully supported in ChadScript)
  return "Hello from ChadScript HTTP Server!";
}

// Start HTTP server on port 3000
const port = 3000;
console.log("Starting HTTP server...");
httpServe(port, handleRequest);
