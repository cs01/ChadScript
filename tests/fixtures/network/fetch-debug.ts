interface JsonTestResponse {
  status: string;
  message: string;
}

console.log("Step 1: Fetching...");
const response1 = fetch("http://localhost:9998/test");
console.log("Step 2: Got response");

console.log("Step 3: Checking ok...");
if (!response1.ok) {
  console.log("FAIL: response1.ok is false");
  throw new Error("Expected response1.ok to be true");
}
console.log("Step 4: ok is true");

console.log("Step 5: Checking status...");
if (response1.status !== 200) {
  console.log("FAIL: status is not 200");
  throw new Error("Expected status 200");
}
console.log("Step 6: status is 200");

console.log("Step 7: Getting text...");
const body1 = response1.text();
console.log("Step 8: Got text, splitting...");
const lines1 = body1.split("\n");
console.log("Step 9: Checking line count...");
if (lines1.length < 3) {
  console.log("FAIL: Not enough lines");
  throw new Error("Expected at least 3 lines in response");
}
console.log("Step 10: Enough lines");

console.log("Step 11: Fetching JSON endpoint...");
const response2 = fetch("http://localhost:9998/json");
if (!response2.ok) {
  console.log("FAIL: response2.ok is false");
  throw new Error("Expected response2.ok to be true");
}
console.log("Step 12: Parsing JSON...");
const json2 = response2.json<JsonTestResponse>();
console.log("Step 13: Checking json status...");
if (json2.status !== "ok") {
  console.log("FAIL: json2.status is not ok");
  throw new Error("Expected json2.status to equal 'ok'");
}
console.log("Step 14: json status ok");

console.log("Step 15: Checking message...");
if (json2.message !== "JSON response") {
  console.log("FAIL: message mismatch");
  throw new Error("Expected json2.message to equal 'JSON response'");
}
console.log("Step 16: message ok");

console.log("Step 17: Fetching plain...");
const response3 = fetch("http://localhost:9998/plain");
if (!response3.ok) {
  console.log("FAIL: response3.ok is false");
  throw new Error("Expected response3.ok to be true");
}
console.log("Step 18: Getting plain text...");
const body3 = response3.text();
console.log("Step 19: Checking exact match...");
if (body3 !== "Hello from ChadScript test server") {
  console.log("FAIL: body3 mismatch");
  throw new Error("Expected exact plain text match");
}

console.log("TEST_PASSED");
