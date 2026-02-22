// Validates all network syscalls are declared and linkable

function testAllSyscalls(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  console.log("Testing socket syscalls...");

  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    console.log("FAIL: socket()");
    return 1;
  }
  console.log("PASS: socket()");

  const addr = malloc(16);
  console.log("PASS: malloc() for sockaddr");

  const port = htons(8080);
  console.log("PASS: htons()");

  const bindResult = bind(sock, addr, 16);
  if (bindResult < 0) {
    console.log("PASS: bind() called (returned error with uninitialized addr)");
  } else {
    console.log("PASS: bind() succeeded");
  }

  const listenResult = listen(sock, 5);
  if (listenResult < 0) {
    console.log("PASS: listen() called (returned error on unbound socket)");
  } else {
    console.log("PASS: listen() succeeded");
  }

  const buffer = malloc(1024);
  console.log("PASS: I/O buffer allocated");

  close(sock);
  free(addr);
  free(buffer);
  console.log("PASS: cleanup complete");

  console.log("All network syscalls validated!");
  console.log("TEST_PASSED");
  return 0;
}

testAllSyscalls();
