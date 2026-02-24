# os

Operating system information. Properties are resolved at compile time; methods call POSIX APIs at runtime.

## Properties

### `os.platform`

```typescript
os.platform    // "linux" or "darwin"
```

Resolved at compile time to the target platform. Defaults to the host platform.

### `os.arch`

```typescript
os.arch    // "x64", "arm64", etc.
```

Resolved at compile time to the target architecture. Defaults to `"x64"`.

### `os.EOL`

```typescript
os.EOL    // "\n"
```

End-of-line marker. Always `"\n"` (Unix-only).

## Methods

### `os.hostname()`

```typescript
const name = os.hostname();    // string
```

### `os.homedir()`

```typescript
const home = os.homedir();    // string — e.g. "/home/user"
```

### `os.tmpdir()`

```typescript
const tmp = os.tmpdir();    // string — e.g. "/tmp"
```

Falls back to `"/tmp"` if `TMPDIR` is not set.

### `os.cpus()`

```typescript
const count = os.cpus();    // number — logical CPU count
```

::: info
Returns the CPU count as a number, not an array of CPU info objects like Node.js.
:::

### `os.totalmem()`

```typescript
const bytes = os.totalmem();    // number — total system memory in bytes
```

### `os.freemem()`

```typescript
const bytes = os.freemem();    // number — free system memory in bytes
```

### `os.uptime()`

```typescript
const seconds = os.uptime();    // number — system uptime in seconds
```

## Example

```typescript
console.log("Platform: " + os.platform);
console.log("Arch: " + os.arch);
console.log("Host: " + os.hostname());
console.log("Home: " + os.homedir());
console.log("CPUs: " + os.cpus());
console.log("Memory: " + os.freemem() + " / " + os.totalmem());
console.log("Uptime: " + os.uptime() + "s");
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `os.platform` | Compile-time string constant |
| `os.arch` | Compile-time string constant |
| `os.EOL` | Compile-time string constant |
| `os.hostname()` | `gethostname()` |
| `os.homedir()` | `getenv("HOME")` |
| `os.tmpdir()` | `getenv("TMPDIR")` with `"/tmp"` fallback |
| `os.cpus()` | `sysconf(_SC_NPROCESSORS_ONLN)` |
| `os.totalmem()` | `sysconf(_SC_PHYS_PAGES) * sysconf(_SC_PAGESIZE)` |
| `os.freemem()` | `chad_os_freemem()` C bridge |
| `os.uptime()` | `chad_os_uptime()` C bridge |
