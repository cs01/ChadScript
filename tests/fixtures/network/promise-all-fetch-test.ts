async function testPromiseAllFetch(): Promise<void> {
  const results = await Promise.all([
    fetch("http://127.0.0.1:19881/a"),
    fetch("http://127.0.0.1:19881/b"),
    fetch("http://127.0.0.1:19881/c")
  ]);

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
