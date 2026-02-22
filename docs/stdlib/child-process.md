# child_process

Execute shell commands and spawn child processes.

## `child_process.execSync(command)`

Execute a shell command synchronously and return stdout as a string.

```typescript
const output = child_process.execSync("ls -la");
console.log(output);
```

Also available as a bare function:

```typescript
const output = execSync("echo hello");
```

## `child_process.spawnSync(command, args?)`

Spawn a process synchronously. Returns an object with `stdout`, `stderr`, and `status`.

```typescript
// Shell mode (single string command)
const result = child_process.spawnSync("echo hello");
console.log(result.stdout);
console.log(result.status); // 0

// Direct mode (command + args array)
const result = child_process.spawnSync("git", ["status", "--short"]);
console.log(result.stdout);
```

## `child_process.exec(command)`

Async version of `execSync`. Returns a `Promise` that resolves with a result object containing `stdout`, `stderr`, and `status`.

```typescript
const result = await child_process.exec("ls -la");
console.log(result.stdout);
```

## `child_process.spawn(command, args?, onStdout, onStderr, onExit)`

Spawn a child process with streaming callbacks. Callbacks must be named function references.

```typescript
function onOut(data: string): void {
  console.log("stdout: " + data);
}
function onErr(data: string): void {
  console.log("stderr: " + data);
}
function onDone(code: number): void {
  console.log("exited: " + code.toString());
}

// Shell mode
child_process.spawn("ls -la", onOut, onErr, onDone);

// Direct mode with args
child_process.spawn("git", ["log", "--oneline"], onOut, onErr, onDone);
```
