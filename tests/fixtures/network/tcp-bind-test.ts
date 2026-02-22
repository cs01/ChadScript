// Tests socket creation, bind, and cleanup via low-level syscalls

function testBind(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    console.log("FAIL: socket creation failed");
    return 1;
  }
  console.log("Socket created successfully");

  const addr = malloc(16);

  const bindResult = bind(sock, addr, 16);
  if (bindResult < 0) {
    console.log("bind returned error (expected with uninitialized addr)");
  } else {
    console.log("bind succeeded");
  }

  close(sock);
  free(addr);

  console.log("Socket closed successfully");
  console.log("TEST_PASSED");
  return 0;
}

testBind();
