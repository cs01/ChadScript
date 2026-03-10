// @test-skip
function getPort(): string {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return args[i + 1];
    }
  }
  return "19878";
}

async function testAsyncFetch(): Promise<string> {
  const port = getPort();
  const response = await fetch("http://127.0.0.1:" + port + "/test");
  if (response.ok) {
    const body = response.text();
    if (body === "/test") {
      console.log("TEST_PASSED");
    } else {
      console.log("Error: unexpected body: " + body);
      process.exit(1);
    }
  } else {
    console.log("Error: fetch failed");
    process.exit(1);
  }
  return "done";
}

testAsyncFetch();
