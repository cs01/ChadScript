// TCP Echo Server - Functional style without interface returns
// Avoids compiler bug with interface return types

function runServer(): void {
  console.log("Starting TCP echo server...");
  
  const AF_INET = 2;
  const SOCK_STREAM = 1;
  
  // Create and setup server socket
  const serverSock = socket(AF_INET, SOCK_STREAM, 0);
  const addr = malloc(16);
  const port = htons(8888);
  
  bind(serverSock, addr, 16);
  listen(serverSock, 5);
  console.log("Server listening on port 8888");
  
  // Accept client connection
  const clientSock = accept(serverSock, 0, 0);
  console.log("Client connected!");
  
  // Read and echo data
  const buffer = malloc(1024);
  const bytesRead = read(clientSock, buffer, 1024);
  
  if (bytesRead > 0) {
    console.log("Received data, echoing back...");
    write(clientSock, buffer, bytesRead);
    console.log("Echo complete");
  }
  
  // Cleanup
  close(clientSock);
  close(serverSock);
  free(buffer);
  free(addr);
  
  console.log("Server shutdown complete");
}

runServer();
