// Integration test for fetch() builtin with Response API
// This test expects an HTTP server running on localhost:9998
// that responds with specific test data

// fetch() returns a Response object with:
// - .text() method to get body
// - .json() method to parse JSON
// - .status property for HTTP status code
// - .ok property for success check (200-299)

interface JsonTestResponse {
  status: string;
  message: string;
}

// Test 1: Basic endpoint with .ok and .status checks
const response1 = fetch("http://localhost:9998/test");
if (!response1.ok) {
  throw new Error("Expected response1.ok to be true");
}
if (response1.status !== 200) {
  throw new Error("Expected status 200");
}
const body1 = response1.text();
const lines1 = body1.split("\n");
if (lines1.length < 3) {
  throw new Error("Expected at least 3 lines in response");
}

// Test 2: JSON endpoint with .json<T>() method
const response2 = fetch("http://localhost:9998/json");
if (!response2.ok) {
  throw new Error("Expected response2.ok to be true");
}
const json2 = response2.json<JsonTestResponse>();
if (json2.status !== "ok") {
  throw new Error("Expected json2.status to equal 'ok'");
}
if (json2.message !== "JSON response") {
  throw new Error("Expected json2.message to equal 'JSON response'");
}

// Test 3: Plain text endpoint
const response3 = fetch("http://localhost:9998/plain");
if (!response3.ok) {
  throw new Error("Expected response3.ok to be true");
}
const body3 = response3.text();
if (body3 !== "Hello from ChadScript test server") {
  throw new Error("Expected exact plain text match");
}

console.log("TEST_PASSED");
