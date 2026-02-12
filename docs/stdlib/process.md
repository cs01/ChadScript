# process

Process utilities, command-line arguments, and environment access. Maps to POSIX process APIs.

## Properties

### `process.argv`

```typescript
process.argv    // string[] — command line arguments
```

`argv[0]` is the first user argument (not the program name, unlike C).

```typescript
const filename = process.argv[0];
console.log(filename);
```

### `process.platform`

```typescript
process.platform    // "linux" or "darwin"
```

### `process.arch`

```typescript
process.arch    // "x64", "arm64", etc.
```

### `process.pid` / `process.ppid`

```typescript
process.pid     // number — current process ID
process.ppid    // number — parent process ID
```

### `process.env`

```typescript
process.env.HOME        // string — environment variable via getenv()
process.env.PATH
process.env.USER
```

### `process.execPath`

```typescript
process.execPath    // string — path to the current executable
```

### `process.argv0`

```typescript
process.argv0    // string — the original argv[0] (program name)
```

### `process.version`

```typescript
process.version    // string — ChadScript version
```

## Methods

### `process.exit(code?)`

```typescript
process.exit(0);    // exit successfully
process.exit(1);    // exit with error
process.exit();     // exit with code 0
```

### `process.cwd()`

```typescript
const dir = process.cwd();    // string — current working directory
```

### `process.chdir(path)`

```typescript
process.chdir("/tmp");
```

### `process.uptime()`

```typescript
const seconds = process.uptime();    // number — seconds since program start
```

### `process.kill(pid, signal)`

```typescript
process.kill(1234, 9);    // send signal to process
```

### `process.abort()`

```typescript
process.abort();    // immediately terminate with SIGABRT
```

### `process.getuid()` / `process.getgid()` / `process.geteuid()` / `process.getegid()`

```typescript
const uid = process.getuid();
const gid = process.getgid();
const euid = process.geteuid();
const egid = process.getegid();
```

### `process.stdout.write(str)` / `process.stderr.write(str)`

Write without a trailing newline:

```typescript
process.stdout.write("no newline");
process.stderr.write("error output");
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `process.exit()` | `exit()` |
| `process.argv` | C `main(argc, argv)` |
| `process.env.X` | `getenv("X")` |
| `process.cwd()` | `getcwd()` |
| `process.chdir()` | `chdir()` |
| `process.uptime()` | `clock_gettime(CLOCK_MONOTONIC)` |
| `process.kill()` | `kill()` |
| `process.stdout.write()` | `printf()` (no newline) |
