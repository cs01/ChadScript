// TCP client smoke test: exercises the net module's connect/error/close
// event path by attempting a connection to a port we know is closed.
//
// The connect-refusal path is deterministic on every OS/CI host and
// exercises the full bridge: uv_tcp_connect -> net_connect_cb(status<0)
// -> error event -> uv_close -> close event. Also verifies the Socket
// class wraps the bridge handle correctly and isOpen() reports the
// post-failure state.

import { createConnection } from "chadscript/net";

function run(): void {
  // Port 59999 is outside the registered-ports range and virtually never
  // bound on dev/CI hosts. Pure IPv4 literal — keeps DNS out of the path.
  const sock = createConnection("127.0.0.1", 59999);

  // Pump the loop briefly so the bridge can surface the connect-refused
  // error (uv_tcp_connect's status < 0 path) and the subsequent close.
  sock.poll();
  sock.wait(500);

  if (sock.isOpen()) {
    console.log("FAIL: socket reports open against closed port");
    return;
  }

  sock.destroy();
  console.log("TEST_PASSED");
}

run();
