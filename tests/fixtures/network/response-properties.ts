// @test-skip
async function main(): Promise<void> {
  const response = await fetch("http://127.0.0.1:18999/");

  const status = response.status;
  console.log(status);

  const ok = response.ok;
  console.log(ok);

  const body = response.text();
  console.log(body);

  const url = response.url;
  console.log(url);

  const statusText = response.statusText;
  console.log(statusText);

  const redirected = response.redirected;
  console.log(redirected);

  const headers = response.headers;
  console.log(headers);

  console.log("TEST_PASSED");
}

await main();
