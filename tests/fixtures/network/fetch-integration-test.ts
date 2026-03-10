// @test-skip
// @test-args: -p 9998

interface JsonTestResponse {
  status: string;
  message: string;
}

function getPort(): string {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return args[i + 1];
    }
  }
  return "9998";
}

async function runTests(): Promise<string> {
  const port = getPort();
  const base = "http://localhost:" + port;

  const response1 = await fetch(base + "/test");
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

  const response2 = await fetch(base + "/json");
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

  const response3 = await fetch(base + "/plain");
  if (!response3.ok) {
    throw new Error("Expected response3.ok to be true");
  }
  const body3 = response3.text();
  if (body3 !== "Hello from ChadScript test server") {
    throw new Error("Expected exact plain text match");
  }

  console.log("TEST_PASSED");
  return "done";
}

runTests();
