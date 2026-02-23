# fs

Filesystem operations using POSIX file I/O. Both sync and async APIs are available.

## Synchronous

### `fs.readFileSync(path)`

Read the entire contents of a file as a string.

```typescript
const content = fs.readFileSync("data.txt");
console.log(content);
```

Returns an empty string if the file doesn't exist.

When the result is assigned to a `Uint8Array` variable, the file is read in binary mode (`"rb"`) and the raw bytes are returned:

```typescript
const data: Uint8Array = fs.readFileSync("image.png");
console.log(data.length); // exact byte count, including null bytes
```

### `fs.writeFileSync(path, data)`

Write a string to a file, replacing the file if it already exists.

```typescript
fs.writeFileSync("output.txt", "hello world");
```

When the second argument is a `Uint8Array`, the file is written in binary mode using the array's length (not `strlen`), so null bytes are preserved:

```typescript
const data = new Uint8Array(4);
data[0] = 0x89;
data[1] = 0x50;
data[2] = 0x00; // null byte — preserved in binary write
data[3] = 0x47;
fs.writeFileSync("output.bin", data);
```

Returns 0 on success, -1 on error.

### `fs.appendFileSync(path, data)`

Append a string to a file.

```typescript
fs.appendFileSync("log.txt", "new line\n");
```

### `fs.existsSync(path)`

Check if a file exists.

```typescript
if (fs.existsSync("config.json")) {
  const cfg = fs.readFileSync("config.json");
}
```

### `fs.unlinkSync(path)`

Delete a file.

```typescript
fs.unlinkSync("temp.txt");
```

Returns 0 on success, -1 on error.

### `fs.mkdirSync(path)`

Create a directory.

```typescript
fs.mkdirSync("output");
```

### `fs.readdirSync(path)`

List files in a directory. Excludes `.` and `..`.

```typescript
const files = fs.readdirSync(".");
files.forEach((f: string) => {
  console.log(f);
});
```

### `fs.statSync(path)`

Get file metadata.

```typescript
const stat = fs.statSync("data.txt");
console.log(stat.size);          // number — file size in bytes
console.log(stat.isFile);        // boolean
console.log(stat.isDirectory);   // boolean
```

### `fs.renameSync(oldPath, newPath)`

Rename or move a file.

```typescript
fs.renameSync("old.txt", "new.txt");
```

### `fs.copyFileSync(src, dest)`

Copy a file.

```typescript
fs.copyFileSync("original.txt", "backup.txt");
```

## Async (Promise-based)

All async methods return a `Promise` and run on the libuv thread pool via `uv_queue_work`.

### `fs.readFile(path)`

```typescript
const content: string = await fs.readFile("data.txt");
```

### `fs.writeFile(path, data)`

```typescript
await fs.writeFile("output.txt", "hello");
```

### `fs.readdir(path)`

```typescript
const files: string[] = await fs.readdir(".");
```

### `fs.stat(path)`

```typescript
const stat = await fs.stat("data.txt");
console.log(stat.size);
```

### `fs.unlink(path)`

```typescript
await fs.unlink("temp.txt");
```

### `fs.mkdir(path)`

```typescript
await fs.mkdir("output");
```

### `fs.appendFile(path, data)`

```typescript
await fs.appendFile("log.txt", "new line\n");
```

### `fs.rename(oldPath, newPath)`

```typescript
await fs.rename("old.txt", "new.txt");
```

### `fs.copyFile(src, dest)`

```typescript
await fs.copyFile("original.txt", "backup.txt");
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `fs.readFileSync()` | `fopen()` + `fread()` |
| `fs.writeFileSync()` | `fopen()` + `fwrite()` |
| `fs.existsSync()` | `access()` |
| `fs.unlinkSync()` | `unlink()` |
| `fs.readdirSync()` | `opendir()` + `readdir()` |
| `fs.statSync()` | `stat()` |
| `fs.renameSync()` | `rename()` |
| `fs.copyFileSync()` | `fopen()` + `fread()` + `fwrite()` |
| Async variants | Same POSIX calls on `uv_queue_work` thread pool |
