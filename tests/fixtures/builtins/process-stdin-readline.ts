// @test-skip
// Fixture for dapweb NOTES #22: process.stdin.readLine() for MCP / JSON-RPC
// stdio servers. @test-skip because the test harness doesn't feed stdin to
// fixtures; manual verify pattern is:
//   echo -e "hello\nworld\nfoo" | ./bin
// expected output:
//   got: hello
//   got: world
//   got: foo
while (true) {
  const line = process.stdin.readLine();
  if (line === "") break;
  console.log("got: " + line);
}
