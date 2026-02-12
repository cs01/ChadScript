# fs

Filesystem operations using POSIX file I/O. All operations are synchronous.

## `fs.readFileSync(path)`

Read the entire contents of a file as a string.

```typescript
const content = fs.readFileSync("data.txt");
console.log(content);
```

Returns an empty string if the file doesn't exist.

## `fs.writeFileSync(path, data)`

Write a string to a file, replacing the file if it already exists.

```typescript
fs.writeFileSync("output.txt", "hello world");
```

Returns 0 on success, -1 on error.

## `fs.appendFileSync(path, data)`

Append a string to a file.

```typescript
fs.appendFileSync("log.txt", "new line\n");
```

## `fs.existsSync(path)`

Check if a file exists.

```typescript
if (fs.existsSync("config.json")) {
  const cfg = fs.readFileSync("config.json");
}
```

## `fs.unlinkSync(path)`

Delete a file.

```typescript
fs.unlinkSync("temp.txt");
```

Returns 0 on success, -1 on error.

## `fs.readdirSync(path)`

List files in a directory. Excludes `.` and `..`.

```typescript
const files = fs.readdirSync(".");
files.forEach((f: string) => {
  console.log(f);
});
```

## `fs.statSync(path)`

Get file metadata.

```typescript
const stat = fs.statSync("data.txt");
console.log(stat.size);          // number — file size in bytes
console.log(stat.isFile);        // boolean
console.log(stat.isDirectory);   // boolean
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
