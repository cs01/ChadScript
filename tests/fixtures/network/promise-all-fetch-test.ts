// @test-skip
function getPort(): string {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return args[i + 1];
    }
  }
  return "19881";
}

async function testPromiseAllFetch(): Promise<void> {
  const port = getPort();
  const base = "http://127.0.0.1:" + port;

  const results = await Promise.all([fetch(base + "/a"), fetch(base + "/b"), fetch(base + "/c")]);

  const bodyA = results[0].text();
  const bodyB = results[1].text();
  const bodyC = results[2].text();

  if (bodyA !== "response-a") {
    console.log("Error: expected response-a, got " + bodyA);
    process.exit(1);
  }
  if (bodyB !== "response-b") {
    console.log("Error: expected response-b, got " + bodyB);
    process.exit(1);
  }
  if (bodyC !== "response-c") {
    console.log("Error: expected response-c, got " + bodyC);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testPromiseAllFetch();
