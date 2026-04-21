// Deterministic unit test for Socket.upgradeToTLS: calling it on a dead
// (closed-before-use) socket must return false and must not crash or hang.
// This exercises the early-out path in cs_tls_upgrade without touching the
// network, so it runs offline in CI.

import { createConnection } from "chadscript/net";

function run(): void {
  // Port 59999 — deterministic connect-refused. By the time poll/wait
  // returns, the socket is dead (connect_failed + closed both set).
  const sock = createConnection("127.0.0.1", 59999);
  sock.wait(500);

  if (sock.isOpen()) {
    console.log("FAIL: socket reports open against closed port");
    return;
  }

  const upgraded = sock.upgradeToTLS("example.com", 1);
  if (upgraded) {
    console.log("FAIL: upgradeToTLS succeeded on dead socket");
    return;
  }

  sock.destroy();
  console.log("TEST_PASSED");
}

run();
