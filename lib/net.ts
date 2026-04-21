// net.ts — plain TCP client sockets via libuv (c_bridges/net-bridge.c).
//
// API shape mirrors Node's `node:net` closely enough to be familiar:
//
//   import { createConnection } from "chadscript/net";
//   const sock = createConnection("127.0.0.1", 5432);
//   sock.on("connect", (_: string): void => { sock.write("hello"); });
//   sock.on("data", (chunk: string): void => { console.log("got", chunk); });
//   sock.on("close", (_: string): void => { console.log("bye"); });
//   sock.poll();        // drive events and dispatch
//   sock.wait(1000);    // same, blocking up to 1s
//
// ## Known limits
//
// - One listener per event kind. ChadScript's current codegen does not
//   support arrays of function values (`Array<(x) => void>` errors with
//   "function-pointer arrays not yet supported"), so each `on()` call
//   overwrites the previous listener for that event kind. Multi-listener
//   support will land as soon as the runtime grows a function-pointer
//   array type. The four event kinds (connect/data/error/close) cover the
//   Postgres-driver use-case without multi-listener needs.
// - No server-side API (createServer/listen). Client-only today — lws-bridge
//   already covers HTTP/WS server needs; TCP servers will arrive alongside
//   a custom-protocol server use-case (Redis-style, Postgres-proxy, etc.).
// - TLS upgrade: `sock.upgradeToTLS(servername, verify)` upgrades an already-
//   connected plain socket to TLS via OpenSSL (STARTTLS pattern). For
//   implicit-TLS use cases, import from "chadscript/tls" and call
//   `tls.connect({host, port, servername, rejectUnauthorized})`.
// - Callbacks are dispatched from poll()/wait() — not interrupt-driven. User
//   code must periodically call sock.poll() or sock.wait(timeoutMs) from its
//   own event loop. This is a deliberate tradeoff: keeps the FFI surface
//   pure scalar/string (no trampoline-handle plumbing), at the cost of the
//   caller driving the loop.
// - `write()` takes a string (bytes). A `Uint8Array` overload can be added
//   once chad's codegen exposes a byte-aware string constructor for the FFI
//   (Uint8Array.fromRawBytes has the shape; the reverse direction needs a
//   helper).
// - Errors are surfaced as the "error" event with a string payload. No
//   structured error object yet — matches how lws-bridge surfaces failures.
// - The underlying uv_default_loop() is shared with HTTP server, timers, and
//   spawn(). Using net inside an httpServe handler will tick the same loop —
//   callers must not call sock.wait() from within a handler (would recurse
//   into the loop). Use non-blocking poll() from handlers instead.

declare function cs_net_connect(host: string, port: number): string;
declare function cs_net_last_error(sock: string): string;
declare function cs_net_write(sock: string, data: string, len: number): number;
declare function cs_net_poll(sock: string): number;
declare function cs_net_wait(sock: string, timeoutMs: number): number;
declare function cs_net_poll_event_kind(sock: string): number;
declare function cs_net_poll_event_data(sock: string): string;
declare function cs_net_poll_event_len(sock: string): number;
declare function cs_net_poll_event_consume(sock: string): void;
declare function cs_net_end(sock: string): void;
declare function cs_net_destroy(sock: string): void;
declare function cs_net_is_open(sock: string): number;
declare function cs_net_rx_drain(sock: string): string;
declare function cs_net_rx_drain_len(sock: string): number;
declare function cs_tls_upgrade(sock: string, servername: string, verify: number): number;

const NET_EVENT_CONNECT: number = 1;
const NET_EVENT_DATA: number = 2;
const NET_EVENT_ERROR: number = 3;
const NET_EVENT_CLOSE: number = 4;

// Shared no-op listener — used to initialize Socket's callback slots so the
// field type (function) has a valid non-null default. A single module-level
// function reference avoids the `store i8* __lambda_N` IR codegen bug that
// fires when arrow-function literals are assigned in a class constructor.
function _netNoopCb(_d: string): void {}

export class Socket {
  private _handle: string;
  private _dead: number;

  // Single-slot listeners per event kind (see "Known limits" above — chad's
  // codegen can't express `Array<fn>` today). Each slot is either a live
  // function or a sentinel (assigned on construction) that no-ops. The
  // sentinel pattern keeps the invocation path branch-free at the call
  // site.
  private _hasConnect: number;
  private _connectCb: (data: string) => void;
  private _hasData: number;
  private _dataCb: (data: string) => void;
  private _hasError: number;
  private _errorCb: (data: string) => void;
  private _hasClose: number;
  private _closeCb: (data: string) => void;

  constructor(handle: string) {
    this._handle = handle;
    this._dead = 0;
    this._hasConnect = 0;
    this._hasData = 0;
    this._hasError = 0;
    this._hasClose = 0;
    // Callback fields are left as class-default (null function pointer)
    // until a real on() call binds them — guarded by the _has* flags.
    // Explicit sentinel assignments here hit a current chad codegen bug
    // that emits unbound __lambda_N identifiers in the IR.
    this._connectCb = _netNoopCb;
    this._dataCb = _netNoopCb;
    this._errorCb = _netNoopCb;
    this._closeCb = _netNoopCb;
  }

  // Register a listener. The connect listener fires exactly once after the
  // handshake completes. data / error may fire multiple times; close fires
  // at most once per lifetime of the socket. The payload for connect and
  // close is the empty string. Calling on() for an event kind that already
  // has a listener REPLACES it — see "Known limits" for why.
  on(event: string, cb: (data: string) => void): void {
    if (event === "connect") {
      this._connectCb = cb;
      this._hasConnect = 1;
    } else if (event === "data") {
      this._dataCb = cb;
      this._hasData = 1;
    } else if (event === "error") {
      this._errorCb = cb;
      this._hasError = 1;
    } else if (event === "close") {
      this._closeCb = cb;
      this._hasClose = 1;
    }
  }

  // Detach the data listener. Used by a TLS upgrade layer (future) to swap
  // the plaintext handler for a TLS record demultiplexer. The signature
  // parameter is accepted for API symmetry with node:net but ignored —
  // there's only one slot.
  removeDataListener(_cb: (data: string) => void): void {
    this._hasData = 0;
    this._dataCb = _netNoopCb;
  }

  // Send bytes. Returns true if the write was queued, false if the socket
  // is already closed or in error. The bytes are copied synchronously, so
  // the caller can mutate/reuse `data` immediately on return.
  write(data: string): boolean {
    if (this._dead === 1) return false;
    const r = cs_net_write(this._handle, data, data.length);
    return r > 0;
  }

  // Half-close: send FIN. Peer-side reads will EOF, our reads keep working
  // until the peer closes. Idempotent.
  end(): void {
    if (this._dead === 1) return;
    cs_net_end(this._handle);
  }

  // Hard-close. Pending writes are cancelled by libuv. Idempotent.
  destroy(): void {
    if (this._dead === 1) return;
    this._dead = 1;
    cs_net_destroy(this._handle);
  }

  isOpen(): boolean {
    return cs_net_is_open(this._handle) > 0;
  }

  // Upgrade this socket's transport to TLS via OpenSSL (STARTTLS pattern).
  // Drives the handshake synchronously — returns after handshake completes
  // or fails. Pass verify=1 for default certificate verification (system CA
  // chain + servername hostname match), verify=0 to skip (dev/self-signed).
  // After a successful upgrade subsequent write() calls encrypt transparently
  // and data events deliver decrypted plaintext. Returns true on success,
  // false on handshake failure.
  upgradeToTLS(servername: string, verify: number): boolean {
    if (this._dead === 1) return false;
    const r = cs_tls_upgrade(this._handle, servername, verify);
    return r > 0;
  }

  // Expose the underlying handle so the tls.connect() helper can wrap a
  // socket returned from cs_tls_connect without duplicating state. Internal.
  _rawHandle(): string {
    return this._handle;
  }

  // Tick the libuv loop once in non-blocking mode, then dispatch any queued
  // events to listeners. Returns the number of events dispatched. Safe to
  // call from inside handlers for other subsystems.
  poll(): number {
    cs_net_poll(this._handle);
    return this._drain();
  }

  // Block for up to timeoutMs ticking the loop until at least one event
  // shows up for this socket (or the timeout expires). Then dispatch
  // queued events. Returns the number of events dispatched.
  wait(timeoutMs: number): number {
    cs_net_wait(this._handle, timeoutMs);
    return this._drain();
  }

  // Pull-style read helper: drain the internal rx byte buffer and return
  // everything that arrived since the last call. The "data" event fires in
  // parallel with this — callers can pick either style, not both.
  read(): string {
    return cs_net_rx_drain(this._handle);
  }

  readLen(): number {
    return cs_net_rx_drain_len(this._handle);
  }

  // Drain the bridge's event queue, dispatching each event to its listener.
  // Returns the number of events dispatched.
  private _drain(): number {
    let dispatched: number = 0;
    let kind: number = cs_net_poll_event_kind(this._handle);
    while (kind !== 0) {
      const payload: string = cs_net_poll_event_data(this._handle);
      cs_net_poll_event_consume(this._handle);
      dispatched = dispatched + 1;
      if (kind === NET_EVENT_CONNECT) {
        if (this._hasConnect === 1) this._connectCb("");
      } else if (kind === NET_EVENT_DATA) {
        if (this._hasData === 1) this._dataCb(payload);
      } else if (kind === NET_EVENT_ERROR) {
        if (this._hasError === 1) this._errorCb(payload);
      } else if (kind === NET_EVENT_CLOSE) {
        this._dead = 1;
        if (this._hasClose === 1) this._closeCb("");
      }
      kind = cs_net_poll_event_kind(this._handle);
    }
    return dispatched;
  }
}

// Open a TCP connection. Blocks until the handshake completes or fails.
// Always returns a Socket — the caller checks sock.isOpen() (or waits for
// the "error" event) to see whether the connect succeeded. This shape was
// chosen over throw-on-failure because the bridge returns an opaque "NULL"
// pointer on failure, and ChadScript currently compares those to empty
// string unreliably across FFI boundaries. Callers who prefer exception
// semantics can wrap their own check: `if (!sock.isOpen()) throw ...`.
export function createConnection(host: string, port: number): Socket {
  const handle: string = cs_net_connect(host, port);
  return new Socket(handle);
}
