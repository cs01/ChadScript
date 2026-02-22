// Tests TCP client socket creation (connect not yet implemented)

function testTcpClient(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    console.log("Socket failed");
    return 1;
  }

  close(sock);
  console.log("TEST_PASSED");
  return 0;
}

testTcpClient();
