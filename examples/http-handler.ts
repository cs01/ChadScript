// ChadScript HTTP Handler Example (Simplified for Stage 0)
// This is a simplified version that demonstrates function returning interfaces
// without accessing interface fields from parameters.

interface HttpResponse {
  status: number;
  body: string;
}

function homeHandler(): HttpResponse {
  return { status: 200, body: "Hello from ChadScript!" };
}

function jsonHandler(): HttpResponse {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function errorHandler(): HttpResponse {
  return { status: 500, body: "Internal Server Error" };
}

function createdHandler(): HttpResponse {
  return { status: 201, body: "Resource Created" };
}

function notFoundHandler(): HttpResponse {
  return { status: 404, body: "Not Found" };
}

console.log("HTTP Handler example loaded");
console.log("Testing handlers...");

const home = homeHandler();
console.log("Home status:");
console.log(home.status);

console.log("TEST_PASSED");
process.exit(0);
