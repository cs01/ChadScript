# ChadScript TODO

Consolidated from npm-compatibility.md and suggestions.md. Sorted by impact and feasibility.

Items marked DONE were completed in the current session. Items are grouped into tiers based on realistic implementation effort.

---

## DONE

- [x] Destructuring — `const { a, b } = obj`, `const [x, y] = arr`, renaming `const { a: b } = obj`
- [x] Spread operator — `[...arr1, ...arr2]`, `[x, ...arr, y]` for numeric and string arrays
- [x] Rest parameters — `function foo(...args: number[])` with `fn(...arr)` call syntax
- [x] Array.reduce() — named function, arrow function, no-initial-value, numeric and string arrays
- [x] String trimStart() / trimEnd() — trivial variants of existing trim()
- [x] String replaceAll() — loop over existing replace()
- [x] Array.isArray() — static type check at compile time
- [x] process.platform — compile-time string constant ("linux")
- [x] Number.isFinite(), Number.isNaN(), Number.isInteger(), Number.toString()
- [x] process.stdout.write() / process.stderr.write() — raw fd write, no newline
- [x] Object.values(), Object.entries() — static resolution of object fields
- [x] process.env — `getenv()` syscall, chained member access (process.env.PATH)
- [x] process.arch, process.version, process.execPath, process.argv0 — compile-time constants
- [x] process.pid, process.ppid — getpid()/getppid() syscalls
- [x] process.chdir(), process.abort(), process.kill() — directory/signal syscalls
- [x] process.uptime() — clock_gettime(CLOCK_MONOTONIC)
- [x] process.getuid(), process.getgid(), process.geteuid(), process.getegid() — id syscalls
- [x] Async/concurrent fetch — uv_queue_work thread pool, real Promise.all concurrency, proper await with event loop
- [x] Promise.race() — first-to-settle semantics with ObjectArray parameter handling
- [x] tty.isatty() — isatty() syscall for terminal detection

---

## Tier 1 — Quick wins, high impact

Small, well-scoped items that unlock real code patterns or npm packages.

- [ ] new RegExp() constructor + flags (g, i, m) — unlocks ansi-regex, emoji-regex, strip-ansi, semver

## Tier 2 — Medium effort, high payoff

Each one unlocks a meaningful category of code or multiple npm packages.

- [ ] Getters/setters — `get x() { }` / `set x(v) { }` in classes and objects. Unlocks ansi-styles, chalk, lru-cache
- [ ] Optional chaining — `user?.name` desugars to null-check + access. Daily-use safety feature
- [ ] Nullish coalescing — `value ?? default` desugars to null-check ternary
- [ ] String match() / search() — regex capture groups, unlocks semver and brace-expansion
- [ ] RegExp exec() with capture groups — needed for semver, many string parsers
- [ ] String codePointAt() — unicode handling, unlocks string-width
- [ ] fs.readdirSync(), fs.statSync() — directory listing and file metadata, unlocks glob
- [ ] Map iteration (for...of) — iterate Map entries, unlocks lru-cache
- [ ] Set iteration (for...of) — iterate Set values
- [ ] Date object — full constructor, getFullYear/getMonth/getDate/toISOString, formatting
- [ ] Object spread in literals — `{ ...obj, extra: 1 }` (array spread is done, object spread needs struct field copying)

## Tier 3 — Larger projects, transformative impact

These are bigger undertakings but unlock entire categories of usage.

- [ ] User-defined generics — `function map<T, U>(arr: T[], fn: (item: T) => U): U[]`. Needed for any reusable library code
- [ ] macOS + ARM support — Mach-O output, ARM64 target triple, platform linker flags. Unlocks Apple Silicon and Raspberry Pi
- [ ] Integer type — native i64 for binary protocols, array indexing, bitwise ops without f64 precision loss
- [ ] Tagged unions / discriminated unions — `type Result = { ok: true, value: T } | { ok: false, error: string }`. Fundamental TS pattern
- [ ] Better error messages — source-mapped errors pointing to original TS line/column instead of raw LLVM errors
- [ ] Cross-compilation — `chad build --target=linux-arm64 app.ts`. Go's killer feature
- [ ] Faster compilation — incremental builds, parallel IR generation, vendor library caching

## Tier 4 — Long-term vision

Worth considering but not blocking adoption today.

- [ ] Windows support — PE/COFF output format, Windows syscall layer
- [ ] SQLite bindings — link against libsqlite3, provide a built-in `sqlite` module
- [ ] Crypto / hashing — SHA-256, MD5, HMAC via OpenSSL or lightweight lib

---

## NPM Packages Unlocked By Tier

**After Tier 1:** color-name, ms, ansi-regex, emoji-regex, strip-ansi (5 packages, ~5.5B downloads/week)

**After Tier 2:** ansi-styles, supports-color, chalk, debug, semver, brace-expansion, lru-cache, string-width, argparse (9 more packages, ~12B downloads/week)

**After Tier 3:** minimatch, glob, wrap-ansi, color-convert (4 more packages, ~4B downloads/week)
