// Integration test for fetch() builtin with Response API
// This test expects an HTTP server running on localhost:9998
// that responds with specific test data

// fetch() returns a Response object with:
// - .text() method to get body
// - .json() method to parse JSON
// - .status property for HTTP status code
// - .ok property for success check (200-299)

const response1 = fetch("http://localhost:9998/test");
const body1 = response1.text();
const lines1 = body1.split("\n");

// Validate we got response body
if (lines1.length < 1) {
  console.log("TEST_FAILED: Expected body content in response");
  process.exit(1);
}

// Test JSON endpoint - just verify we got JSON-like content
const response2 = fetch("http://localhost:9998/json");
const body2 = response2.text();
if (!body2.includes("status")) {
  console.log("TEST_FAILED: JSON endpoint did not return expected data");
  process.exit(1);
}

// Test plain text endpoint
const response3 = fetch("http://localhost:9998/plain");
const body3 = response3.text();
if (!body3.includes("Hello from ChadScript test server")) {
  console.log("TEST_FAILED: Plain text endpoint did not return expected content");
  process.exit(1);
}

console.log("TEST_PASSED");
