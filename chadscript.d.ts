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
  function statSync(path: string): { size: number; isFile: boolean; isDirectory: boolean };
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
}

// ============================================================================
// SQLite
// ============================================================================

declare namespace sqlite {
  function open(path: string): any;
  function exec(db: any, sql: string): void;
  function get(db: any, sql: string): string;
  function all(db: any, sql: string): string[];
  function close(db: any): void;
}

// ============================================================================
// Child Process
// ============================================================================

declare namespace child_process {
  function execSync(command: string): string;
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

declare function fetch(url: string): Promise<Response>;

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

declare function httpServe(port: number, handler: (req: HttpRequest) => HttpResponse): void;

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
