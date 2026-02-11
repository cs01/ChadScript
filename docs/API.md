# ChadScript API Reference

ChadScript compiles TypeScript/JavaScript to native binaries via LLVM. All built-in modules are linked at compile time against system shared libraries — no runtime is needed.

## Types

| TypeScript | LLVM IR | Notes |
|-----------|---------|-------|
| `number` | `double` | 64-bit float |
| `string` | `i8*` | Null-terminated C string (GC'd) |
| `boolean` | `i1` / `double` | Context-dependent |
| `number[]` | `%Array*` | `{ double*, i32, i32 }` — data, length, capacity |
| `string[]` | `%StringArray*` | `{ i8**, i32, i32 }` — data, length, capacity |

---

## console

```typescript
console.log(value)        // Print value with newline (string or number)
console.log(a, b, c)      // Multiple args, space-separated
console.error(value)       // Print to stderr
```

---

## process

```typescript
process.exit(code?)        // Exit with code (default 0)
process.argv               // string[] — command line arguments
process.platform           // string — "linux" or "darwin"
process.arch               // string — "x64", "arm64", etc.
process.pid                // number
process.ppid               // number
process.env.VARNAME        // string — environment variable via getenv()
process.cwd()              // string — current working directory
process.chdir(path)        // Change working directory
process.uptime()           // number — seconds since epoch
process.getuid()           // number
process.getgid()           // number
process.geteuid()          // number
process.getegid()          // number
process.kill(pid, signal)  // Send signal to process
process.stdout.write(str)  // Write without trailing newline
process.stderr.write(str)  // Write to stderr without trailing newline
```

---

## fs

All operations are synchronous (POSIX file I/O).

```typescript
fs.readFileSync(path)              // string — read entire file
fs.writeFileSync(path, data)       // Write data to file (overwrites)
fs.appendFileSync(path, data)      // Append data to file
fs.existsSync(path)                // boolean — true if file exists
fs.unlinkSync(path)                // Delete file
fs.readdirSync(path)               // string[] — directory listing (excludes . and ..)
fs.statSync(path)                  // { size, isFile, isDirectory }
```

---

## path

```typescript
path.resolve(p)           // string — absolute path
path.dirname(p)           // string — directory component
path.basename(p)          // string — filename component
path.join(a, b)           // string — join with separator
```

---

## JSON

```typescript
JSON.parse(str)                     // Parse JSON string (returns typed object with interface hint)
JSON.parse<MyInterface>(str)        // Parse with type parameter for struct access
JSON.stringify(value)               // Serialize to JSON string
```

---

## Math

```typescript
Math.sqrt(x)              Math.pow(x, y)
Math.floor(x)             Math.ceil(x)
Math.round(x)             Math.abs(x)
Math.max(a, b)            Math.min(a, b)
Math.random()             Math.log(x)
Math.log2(x)              Math.log10(x)
Math.sin(x)               Math.cos(x)
Math.tan(x)               Math.PI
Math.E                    Math.trunc(x)
Math.sign(x)
```

---

## Date

```typescript
Date.now()                // number — milliseconds since epoch
```

---

## crypto

Hash functions and random bytes via OpenSSL (`libcrypto`). All functions return hex-encoded strings.

```typescript
crypto.sha256(input)      // string — SHA-256 hash of input
crypto.md5(input)         // string — MD5 hash of input
crypto.sha512(input)      // string — SHA-512 hash of input
crypto.randomBytes(n)     // string — n random bytes as hex (2n chars)
```

### Example

```typescript
const hash = crypto.sha256("hello");
// "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

const token = crypto.randomBytes(16);
// 32-character random hex string
```

---

## sqlite

Database operations via `libsqlite3`. The `db` handle is an opaque pointer returned by `open()`.

```typescript
sqlite.open(path)          // Open database, returns db handle
sqlite.exec(db, sql)       // Execute DDL/DML (CREATE, INSERT, UPDATE, DELETE)
sqlite.get(db, sql)        // string — first column of first row
sqlite.all(db, sql)        // string[] — first column of all rows
sqlite.close(db)           // Close database
```

`get` and `all` return the first column only. Select the column you need:

```typescript
const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE users (id INTEGER, name TEXT)");
sqlite.exec(db, "INSERT INTO users VALUES (1, 'Alice')");
sqlite.exec(db, "INSERT INTO users VALUES (2, 'Bob')");

const name = sqlite.get(db, "SELECT name FROM users WHERE id = 1");
// "Alice"

const names = sqlite.all(db, "SELECT name FROM users ORDER BY id");
// ["Alice", "Bob"]

sqlite.close(db);
```

---

## child_process

```typescript
child_process.execSync(command)    // string — execute shell command, return stdout
```

---

## fetch

HTTP client via `libcurl`.

```typescript
const response = fetch(url);
const body = response.text();      // string — response body
const data = response.json();      // parsed JSON
const status = response.status;    // number — HTTP status code
const ok = response.ok;            // boolean — true if 2xx
```

---

## String Methods

```typescript
str.length                 // number
str.charAt(i)              // string
str.charCodeAt(i)          // number
str.indexOf(sub)           // number (-1 if not found)
str.includes(sub)          // boolean
str.startsWith(prefix)     // boolean
str.endsWith(suffix)       // boolean
str.slice(start, end?)     // string
str.substr(start, len?)    // string
str.substring(start, end)  // string
str.trim()                 // string
str.trimStart()            // string
str.trimEnd()              // string
str.toUpperCase()          // string
str.toLowerCase()          // string
str.split(delimiter)       // string[]
str.repeat(count)          // string
str.padStart(len, pad)     // string
str.replace(search, repl)  // string (first occurrence)
str.replaceAll(search, repl) // string (all occurrences)
str.concat(other)          // string
str[i]                     // number (char code at index)
```

---

## Array Methods

```typescript
arr.length                 // number
arr.push(element)          // number (new length)
arr.pop()                  // element
arr.includes(element)      // boolean
arr.indexOf(element)       // number
arr.find(fn)               // element or undefined
arr.some(fn)               // boolean
arr.every(fn)              // boolean
arr.map(fn)                // new array
arr.filter(fn)             // new array
arr.forEach(fn)            // void
arr.reduce(fn, init?)      // accumulated value
arr.slice(start?, end?)    // new array
arr.concat(other)          // new array
arr.join(separator?)       // string
Array.isArray(value)       // boolean
```

---

## Map

```typescript
const m = new Map<K, V>();
m.set(key, value)
m.get(key)                 // value
m.has(key)                 // boolean
m.delete(key)              // boolean
m.clear()
m.size                     // number
```

---

## Set

```typescript
const s = new Set<T>();
s.add(value)
s.has(value)               // boolean
s.delete(value)            // boolean
s.size                     // number
```

---

## RegExp

```typescript
const re = /pattern/flags;
const re2 = new RegExp(pattern, flags);
re.test(str)               // boolean
re.exec(str)               // string[] (match groups) or null
str.match(re)              // string[] or null
```

Supported flags: `i` (case-insensitive), `m` (multiline).

---

## Object

```typescript
Object.keys(obj)           // string[]
Object.values(obj)         // string[] (values as strings)
Object.entries(obj)        // string[] (alternating key/value)
typeof value               // string — "number", "string", "boolean", "object"
```

---

## Number

```typescript
Number.isFinite(x)         // boolean
Number.isNaN(x)            // boolean
Number.isInteger(x)        // boolean
parseInt(str, radix?)      // number
parseFloat(str)            // number
x.toString()               // string
```

---

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
