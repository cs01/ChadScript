/**
 * ChadScript Built-in Global Types
 *
 * Type definitions for ChadScript's built-in runtime APIs. These globals
 * are available without imports in all ChadScript programs and are compiled
 * directly to native code via LLVM.
 *
 * Generate this file in any project with: chad init
 *
 * Note: Standard JavaScript types (String, Number, Array, etc.) are provided
 * by TypeScript's ES2020 lib. This file only defines ChadScript-specific APIs.
 */

// ============================================================================
// Console
// ============================================================================

declare namespace console {
  function log(...args: any[]): void;
  function error(...args: any[]): void;
  function warn(...args: any[]): void;
  function debug(...args: any[]): void;
}

// ============================================================================
// Process
// ============================================================================

declare namespace process {
  // ChadScript convention differs from Node:
  //   - argv[0] is the FIRST USER ARG (not the binary path or script name)
  //   - argv0 (separate field) holds the binary path
  // If you're porting a Node-shaped CLI loop, drop `.slice(2)` — ChadScript
  // already starts at user args. For any non-trivial parsing, prefer the
  // ArgumentParser class from `chadscript/argparse`.
  const argv: string[];
  const argv0: string;
  const platform: string;
  const arch: string;
  const pid: number;
  const ppid: number;
  const execPath: string;
  const version: string;

  const env: { [key: string]: string };

  function exit(code?: number): never;
  function cwd(): string;
  function chdir(path: string): void;
  function uptime(): number;
  function kill(pid: number, signal?: number): void;
  function abort(): never;
  function getuid(): number;
  function getgid(): number;
  function geteuid(): number;
  function getegid(): number;

  namespace stdout {
    function write(str: string): void;
  }
  namespace stderr {
    function write(str: string): void;
  }
  namespace stdin {
    // Reads the entire rest of stdin to EOF and returns it as a string.
    // Good for filter-shaped tools (`cat | tool`) and one-shot pipes.
    function read(): string;
    // Reads a single line from stdin (blocking). Strips the trailing \n
    // (and preceding \r for CRLF). Returns "" on EOF — callers that need
    // to distinguish "empty line" from "EOF" should tag their protocol
    // accordingly (MCP / JSON-RPC lines are never empty).
    //
    // Intended for line-oriented protocols: MCP stdio server, JSON-RPC,
    // LSP, simple REPLs.
    function readLine(): string;
  }
}

// ============================================================================
// Filesystem
// ============================================================================

declare namespace fs {
  function readFileSync(filename: string): string;
  function writeFileSync(filename: string, data: string): number;
  function appendFileSync(filename: string, data: string): void;
  function existsSync(filename: string): boolean;
  function unlinkSync(filename: string): number;
  function readdirSync(path: string): string[];
  function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean };
}

// ============================================================================
// Path
// ============================================================================

declare namespace path {
  function join(a: string, b: string): string;
  function resolve(p: string): string;
  function dirname(p: string): string;
  function basename(p: string): string;
}

// ============================================================================
// Math
// ============================================================================

declare namespace Math {
  const PI: number;
  const E: number;

  function sqrt(x: number): number;
  function pow(base: number, exp: number): number;
  function floor(x: number): number;
  function ceil(x: number): number;
  function round(x: number): number;
  function abs(x: number): number;
  function max(a: number, b: number): number;
  function min(a: number, b: number): number;
  function random(): number;
  function log(x: number): number;
  function log2(x: number): number;
  function log10(x: number): number;
  function sin(x: number): number;
  function cos(x: number): number;
  function tan(x: number): number;
  function trunc(x: number): number;
  function sign(x: number): number;
}

// ============================================================================
// Date
// ============================================================================

declare namespace Date {
  function now(): number;
}

// ============================================================================
// JSON
// ============================================================================

declare namespace JSON {
  function parse<T>(str: string): T;
  function stringify(value: any): string;
}

// ============================================================================
// Crypto
// ============================================================================

declare namespace crypto {
  function sha256(input: string): string;
  function sha512(input: string): string;
  function md5(input: string): string;
  function randomBytes(n: number): string;
  function hmacSha256(key: string, data: string): string;
}

// ============================================================================
// SQLite
// ============================================================================

declare namespace sqlite {
  function open(path: string): any;
  function exec(db: any, sql: string, params?: any[]): void;
  function get(db: any, sql: string, params?: any[]): string;
  function getRow<T = any>(db: any, sql: string, params?: any[]): T;
  function all(db: any, sql: string, params?: any[]): string[];
  function query<T = any>(db: any, sql: string, params?: any[]): T[];
  function close(db: any): void;
}

// ============================================================================
// Child Process
// ============================================================================

declare namespace child_process {
  function execSync(command: string): string;
  function exec(command: string): Promise<{ stdout: string; stderr: string; status: number }>;
  function spawnSync(
    command: string,
    args?: string[],
  ): { stdout: string; stderr: string; status: number };
  // spawn returns an opaque handle (i8*) usable with writeStdin/endStdin/kill.
  // Callbacks can be named function references OR arrow functions with
  // captured state — arrow closures are lifted and dispatched through a
  // per-shape C-ABI trampoline (see trampoline-bridge). Per-session demux
  // (formerly spawnTagged) is just a capture now:
  //   child_process.spawn(cmd, args,
  //     (d) => onOut(sessionId, d),
  //     (d) => onErr(sessionId, d),
  //     (c) => onExit(sessionId, c));
  function spawn(
    command: string,
    args: string[],
    onStdout: (data: string) => void,
    onStderr: (data: string) => void,
    onExit: (code: number) => void,
  ): string;
  function spawn(
    command: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void,
    onExit: (code: number) => void,
  ): string;
  function writeStdin(handle: string, data: string): void;
  function endStdin(handle: string): void;
  function kill(handle: string, signum?: number): void;
}

// ============================================================================
// OS
// ============================================================================

declare namespace os {
  const platform: string;
  const arch: string;
  const EOL: string;

  function hostname(): string;
  function homedir(): string;
  function tmpdir(): string;
  function cpus(): number;
  function totalmem(): number;
  function freemem(): number;
  function uptime(): number;
}

// ============================================================================
// TTY
// ============================================================================

declare namespace tty {
  function isatty(fd: number): boolean;
}

// ============================================================================
// Number
// ============================================================================

declare namespace Number {
  function isFinite(x: number): boolean;
  function isNaN(x: number): boolean;
  function isInteger(x: number): boolean;
}

// ============================================================================
// Object
// ============================================================================

declare namespace Object {
  function keys(obj: any): string[];
  function values(obj: any): string[];
  function entries(obj: any): string[];
}

// ============================================================================
// HTTP & Networking
// ============================================================================

interface Response {
  text(): string;
  json<T>(): T;
  status: number;
  ok: boolean;
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

declare function fetch(url: string, options?: FetchOptions): Promise<Response>;

// Promise augmentations for deferred construction. Avoids the closure-
// capture requirement of `new Promise((resolve, reject) => stash(...))`
// for patterns where resolve/reject need to be stored and invoked later
// from a separate scope (request/response wires, callback-to-promise
// bridges). A Promise<T> from deferred() can be passed around like any
// other value and settled via the static helpers.
interface PromiseConstructor {
  deferred<T>(): Promise<T>;
  resolvePending<T>(promise: Promise<T>, value: T): void;
  rejectPending(promise: Promise<unknown>, reason: string): void;
}

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
  bodyLen: number;
  queryString: string;
}

interface HttpResponse {
  status: number;
  body: string;
  headers: string;
  bodyLen: number;
}

interface WsEvent {
  data: string;
  event: string;
  connId: string;
}

// ============================================================================
// Async / Timers
// ============================================================================

declare function setTimeout(callback: () => void, delay: number): number;
declare function setInterval(callback: () => void, interval: number): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;
declare function runEventLoop(): void;

// ============================================================================
// Global Functions
// ============================================================================

declare function parseInt(str: string, radix?: number): number;
declare function parseFloat(str: string): number;
declare function isNaN(value: any): boolean;
declare function execSync(command: string): string;

// ============================================================================
// Low-Level System Calls
// ============================================================================

declare function malloc(size: number): number;
declare function free(ptr: number): void;
declare function socket(domain: number, type: number, protocol: number): number;
declare function bind(socket: number, addr: number, addrlen: number): number;
declare function listen(socket: number, backlog: number): number;
declare function accept(socket: number, addr: number, addrlen: number): number;
declare function htons(hostshort: number): number;
declare function close(fd: number): number;
declare function read(fd: number, buf: number, count: number): number;
declare function write(fd: number, buf: number, count: number): number;

// ============================================================================
// Test Runner
// ============================================================================

declare namespace assert {
  function strictEqual(actual: any, expected: any): void;
  function notStrictEqual(actual: any, expected: any): void;
  function deepEqual(actual: any, expected: any): void;
  function ok(value: any): void;
  function fail(message?: string): void;
}

declare function test(name: string, fn: () => void): void;
declare function describe(name: string, fn: () => void): void;

// ============================================================================
// Compile-Time File Embedding
// ============================================================================

declare namespace ChadScript {
  function embedFile(path: string): string;
  function embedDir(path: string): void;
  function getEmbeddedFile(key: string): string;
  function getEmbeddedFileAsUint8Array(key: string): Uint8Array;
  function serveEmbedded(path: string): HttpResponse;
}

interface MultipartPart {
  name: string;
  filename: string;
  contentType: string;
  data: string;
  dataLen: number;
}

// ============================================================================
// stdlib modules (import { ... } from "chadscript/*")
// ============================================================================

declare module "chadscript/argparse" {
  export class ArgumentParser {
    constructor(programName: string, description: string);
    addFlag(name: string, shortFlag: string, help: string): void;
    addOption(name: string, shortFlag: string, help: string, defaultVal: string): void;
    parse(argv: string[]): number;
    getFlag(name: string): boolean;
    getOption(name: string): string;
  }
}

declare module "chadscript/net" {
  // Plain TCP client sockets via libuv. Prerequisite for protocol
  // drivers (e.g. pure-TS Postgres). Event-driven; use on() + poll()/wait(),
  // or the pull-style read() helper — not both for the same event kind.
  export class Socket {
    // Register a listener. Replaces any previous listener for the same
    // event (single-slot per kind). Payload is the empty string for
    // 'connect' and 'close'; 'data' delivers the chunk; 'error' delivers
    // the libuv error message.
    on(event: "connect" | "data" | "error" | "close", cb: (data: string) => void): void;

    // Detach the 'data' listener. Used by a future TLS upgrade layer to
    // swap the plaintext handler for a TLS record demultiplexer.
    removeDataListener(cb: (data: string) => void): void;

    // Send bytes. Returns true if queued, false if the socket is closed
    // or in error. Bytes are copied synchronously.
    write(data: string): boolean;

    // Half-close (FIN). Peer-side reads EOF; our reads keep working
    // until the peer closes. Idempotent.
    end(): void;

    // Hard-close. Pending writes are cancelled. Idempotent.
    destroy(): void;

    // True while the connection is healthy. Flips to false after
    // 'error' or 'close'.
    isOpen(): boolean;

    // Tick the libuv loop once (non-blocking) and dispatch queued
    // events. Returns number of events dispatched.
    poll(): number;

    // Block for up to timeoutMs ticking the loop until at least one
    // event shows up (or timeout). Then dispatch. Returns number of
    // events dispatched.
    wait(timeoutMs: number): number;

    // Pull-style read: drain the rx byte buffer. Parallel to the
    // 'data' event — callers pick either style, not both.
    read(): string;
    readLen(): number;
  }

  // Open a TCP connection. Returns immediately; handshake completes
  // asynchronously. Always returns a Socket — check sock.isOpen() (or
  // wait for the 'error' event) to see whether the connect succeeded.
  export function createConnection(host: string, port: number): Socket;
}

declare module "chadscript/http" {
  export function getHeader(headersRaw: string, name: string): string;
  export function parseQueryString(qs: string): Map<string, string>;
  export function parseCookies(cookieHeader: string): Map<string, string>;
  export function httpServe(port: number, handler: (req: HttpRequest) => HttpResponse): void;
  export function httpServe(
    port: number,
    handler: (req: HttpRequest) => HttpResponse,
    wsHandler: (event: WsEvent) => string,
  ): void;
  export function wsBroadcast(message: string): void;
  export function wsSend(connId: string, message: string): void;
  export function parseMultipart(req: HttpRequest): MultipartPart[];
  export function bytesResponse(data: Uint8Array, status: number, headers: string): HttpResponse;
  export function serveFile(path: string, contentType: string): HttpResponse;

  export class RouterRequest {
    method: string;
    path: string;
    body: string;
    contentType: string;
    headers: string;
    bodyLen: number;
    param(name: string): string;
    header(name: string): string;
    bodyBytes(): Uint8Array;
  }

  export class Context {
    req: RouterRequest;
    status(code: number): Context;
    header(name: string, value: string): Context;
    text(body: string): HttpResponse;
    json(data: any): HttpResponse;
    html(body: string): HttpResponse;
    redirect(url: string): HttpResponse;
    bytes(data: Uint8Array, contentType: string): HttpResponse;
  }

  export class Router {
    get(pattern: string, handler: (c: Context) => HttpResponse): void;
    post(pattern: string, handler: (c: Context) => HttpResponse): void;
    put(pattern: string, handler: (c: Context) => HttpResponse): void;
    delete(pattern: string, handler: (c: Context) => HttpResponse): void;
    all(pattern: string, handler: (c: Context) => HttpResponse): void;
    notFound(handler: (c: Context) => HttpResponse): void;
    handle(req: HttpRequest): HttpResponse;
  }
}
