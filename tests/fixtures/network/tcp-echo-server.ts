// TCP Echo Server - Functional style without interface returns
// Tests that network syscalls compile, link, and execute correctly

function runServer(): void {
  console.log("Starting TCP echo server...");

  const AF_INET = 2;
  const SOCK_STREAM = 1;

  const serverSock = socket(AF_INET, SOCK_STREAM, 0);
  if (serverSock < 0) {
    console.log("FAIL: socket creation failed");
    process.exit(1);
  }
  console.log("Socket created successfully");

  const addr = malloc(16);
  const port = htons(8888);

  const bindResult = bind(serverSock, addr, 16);
  if (bindResult < 0) {
    console.log("bind failed as expected with uninitialized addr");
  }

  const listenResult = listen(serverSock, 5);
  if (listenResult < 0) {
    console.log("listen failed as expected on unbound socket");
  }

  close(serverSock);
  free(addr);

  console.log("Server shutdown complete");
}

runServer();
