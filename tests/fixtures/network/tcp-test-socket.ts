// Tests basic TCP socket creation and close via low-level syscalls
// @test-exit-code: 0

function testSocket(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    return 1;
  }

  close(sock);
  console.log("TEST_PASSED");
  return 0;
}

testSocket();
