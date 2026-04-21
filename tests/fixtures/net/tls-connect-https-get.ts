// @test-skip
// Skipped by default — needs outbound network. Run manually to validate
// the implicit-TLS path:
//   node dist/chad-node.js run tests/fixtures/net/tls-connect-https-get.ts
//
// Exercises tls.connect() end-to-end: TCP connect + handshake, plaintext
// write, ciphertext wire, decrypted read. A successful TLS 1.2/1.3 session
// to a public HTTPS server should return an HTTP response starting with
// "HTTP/1.1" and carrying a non-empty body.

import { connect } from "chadscript/tls";

function run(): void {
  const sock = connect({
    host: "example.com",
    port: 443,
    servername: "example.com",
    rejectUnauthorized: true,
  });

  if (!sock.isOpen()) {
    console.log("FAIL: tls connect failed");
    return;
  }

  const ok = sock.write("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
  if (!ok) {
    console.log("FAIL: tls write failed");
    return;
  }

  // Drain for up to 5 seconds. HTTP/1.1 response with Connection: close
  // terminates when the peer closes; we keep waiting while the socket is
  // open and we haven't exceeded 10 polls of a 500ms slot each.
  let received: string = "";
  let iterations: number = 0;
  while (iterations < 20) {
    sock.wait(500);
    const chunk = sock.read();
    if (chunk.length > 0) received = received + chunk;
    if (!sock.isOpen()) break;
    iterations = iterations + 1;
  }

  sock.destroy();

  if (received.length < 12) {
    console.log("FAIL: too few bytes received: " + received.length.toString());
    return;
  }
  // First line should be the HTTP status line. We don't pin the exact code —
  // example.com has returned 200 and 301 at various times.
  if (received.substring(0, 7) !== "HTTP/1.") {
    console.log("FAIL: bad status line: " + received.substring(0, 20));
    return;
  }

  console.log("TEST_PASSED");
}

run();
