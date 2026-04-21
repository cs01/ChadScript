// tls.ts — implicit-TLS client sockets via OpenSSL (c_bridges/net-bridge.c).
//
// Wraps `cs_tls_connect` — a combined TCP-connect + TLS-handshake call. The
// returned Socket is a regular net.Socket with the TLS layer active; read/
// write/poll/wait all behave identically, operating on plaintext. Ciphertext
// stays inside the bridge.
//
// For STARTTLS (plain connect first, then upgrade after a protocol negotiation
// message), use `net.createConnection()` followed by `sock.upgradeToTLS(...)`.
//
// Example:
//   import { connect } from "chadscript/tls";
//   const sock = connect({
//     host: "www.example.com", port: 443,
//     servername: "www.example.com", rejectUnauthorized: true,
//   });
//   if (!sock.isOpen()) { console.error("tls failed"); process.exit(1); }
//   sock.write("GET / HTTP/1.1\r\nHost: www.example.com\r\nConnection: close\r\n\r\n");
//   sock.wait(5000);
//   console.log(sock.read());

import { Socket } from "./net.js";

declare function cs_tls_connect(
  host: string,
  port: number,
  servername: string,
  verify: number,
): string;

export interface TlsConnectOpts {
  host: string;
  port: number;
  servername: string;
  rejectUnauthorized: boolean;
}

// Open a TLS connection synchronously (drives the handshake inline via the
// bridge). Returns a Socket — check sock.isOpen() to see whether the
// connect + handshake succeeded.
export function connect(opts: TlsConnectOpts): Socket {
  const verify: number = opts.rejectUnauthorized ? 1 : 0;
  const handle: string = cs_tls_connect(opts.host, opts.port, opts.servername, verify);
  return new Socket(handle);
}
