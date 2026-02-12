# child_process

Execute shell commands.

## `child_process.execSync(command)`

Execute a shell command and return stdout as a string.

```typescript
const output = child_process.execSync("ls -la");
console.log(output);
```

```typescript
const version = child_process.execSync("gcc --version");
console.log(version);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `child_process.execSync()` | `popen()` + `fread()` |
