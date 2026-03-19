// @test-skip
// @test-description: sync fetch with options - method, headers, body

async function main(): Promise<string> {
  const response = await fetch("http://httpbin.org/post", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: '{"key":"value"}',
  });
  console.log("status: " + response.status.toString());
  if (response.ok) {
    console.log("TEST_PASSED");
  }
  return "done";
}

main();
