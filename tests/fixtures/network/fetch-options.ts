// @test-skip
// Tests fetch() with method, headers, and body options.
// Requires a running HTTP server to validate — skipped in CI.

async function main() {
  const resp = await fetch("http://httpbin.org/post", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Custom": "hello",
    },
    body: '{"key":"value"}',
  });
  console.log(resp.status);
  console.log(resp.text());

  const putResp = await fetch("http://httpbin.org/put", {
    method: "PUT",
    body: "updated data",
  });
  console.log(putResp.status);

  const getResp = await fetch("http://httpbin.org/get", {
    headers: {
      Accept: "application/json",
    },
  });
  console.log(getResp.status);
}

main();
