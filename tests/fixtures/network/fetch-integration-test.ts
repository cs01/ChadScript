// Integration test for fetch() builtin
// This test expects an HTTP server running on localhost:9998
// that responds with specific test data

const response1 = fetch("http://localhost:9998/test");
const lines1 = response1.split("\n");

// Validate we got HTTP headers and body
if (lines1.length < 2) {
  throw new Error("TEST_FAILED: Expected multiple lines in response");
}

// Test JSON endpoint - just verify we got JSON-like content
const response2 = fetch("http://localhost:9998/json");
if (!response2.includes("status")) {
  throw new Error("TEST_FAILED: JSON endpoint did not return expected data");
}

// Test plain text endpoint
const response3 = fetch("http://localhost:9998/plain");
if (!response3.includes("Hello from ChadScript test server")) {
  throw new Error("TEST_FAILED: Plain text endpoint did not return expected content");
}

throw new Error("TEST_PASSED");
