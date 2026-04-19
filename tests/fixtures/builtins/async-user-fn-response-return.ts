// @test-skip
// Fixture for dapweb NOTES #20: async function returning Promise<Response>
// was coerced to i8*/string at the await site, corrupting the struct
// pointer. This skipped-at-test-time because it would need a live HTTP
// server to exercise .status/.text(). The regression the fix closes is
// the compile failure + IR type-mismatch — verified manually.
async function httpGet(url: string): Promise<Response> {
  return await fetch(url);
}

async function main(): Promise<void> {
  const r = await httpGet("http://localhost:65432/noexist");
  console.log("status=" + r.status);
}

main();
runEventLoop();
