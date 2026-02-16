# Standard Library Overview

ChadScript ships with a full standard library compiled to native code. No npm, no `node_modules`, no bundler. All APIs are available as globals — no imports needed.

| Module | APIs |
|--------|------|
| [`console`](/stdlib/console) | `log`, `error` |
| [`process`](/stdlib/process) | `argv`, `exit`, `env`, `platform`, `arch`, `pid`, `cwd`, `stdout.write`, `stderr.write` |
| [`fs`](/stdlib/fs) | `readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync`, `readdirSync`, `statSync`, `appendFileSync` |
| [`path`](/stdlib/path) | `join`, `resolve`, `dirname`, `basename` |
| [`Math`](/stdlib/math) | `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `pow`, `random`, `PI`, `E`, `log`, `sin`, `cos`, `tan` |
| [`JSON`](/stdlib/json) | `parse<T>`, `stringify` |
| [`String`](/stdlib/string) | `length`, `split`, `indexOf`, `includes`, `slice`, `trim`, `replace`, `startsWith`, `endsWith`, `charAt` |
| [`Number`](/stdlib/number) | `isFinite`, `isNaN`, `isInteger`, `toString` |
| [`Array`](/stdlib/array) | `length`, `push`, `pop`, `map`, `filter`, `find`, `forEach`, `some`, `includes`, `slice`, `indexOf`, `join`, `concat`, `reduce` |
| [`Map`](/stdlib/map) | `set`, `get`, `has`, `delete`, `size`, `keys`, `values` |
| [`Set`](/stdlib/set) | `add`, `has`, `delete`, `size` |
| [`RegExp`](/stdlib/regexp) | `test`, `exec`, `match` |
| [`Object`](/stdlib/object) | `keys`, `values`, `entries` |
| [`tty`](/stdlib/tty) | `isatty` |
| [`crypto`](/stdlib/crypto) | `sha256`, `md5`, `sha512`, `randomBytes` |
| [`sqlite`](/stdlib/sqlite) | `open`, `exec`, `get`, `all`, `close` |
| [`fetch`](/stdlib/fetch) | HTTP client via libcurl |
| [`httpServe`](/stdlib/http-server) | HTTP server via libwebsockets |
| [`Async`](/stdlib/async) | `async`/`await`, `Promise.all`, `Promise.race`, `setTimeout`, `setInterval` |
| [`child_process`](/stdlib/child-process) | `execSync` |
| [`Date`](/stdlib/date) | `Date.now()` |
| [`test`](/stdlib/test-runner) | `test`, `assert.strictEqual`, `assert.ok`, `assert.fail` |
| [Low-Level](/stdlib/syscalls) | `malloc`, `free`, `socket`, `bind`, `listen`, `accept`, `read`, `write`, `close` |

## Linked Libraries

ChadScript links against these system libraries at compile time:

| Library | Purpose |
|---------|---------|
| `libgc` (Boehm GC) | Garbage collection |
| `libcjson` | JSON parsing |
| `libuv` | Event loop, timers |
| `libcurl` | HTTP client (fetch) |
| `libcrypto` (OpenSSL) | Hashing, random bytes |
| `libsqlite3` | SQLite database |
| `libm` | Math functions |
| `libpthread` | Threading |
