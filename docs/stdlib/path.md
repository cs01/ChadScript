# path

Path manipulation utilities using POSIX path functions.

## `path.join(a, b)`

Join two path segments with the platform separator.

```typescript
const full = path.join("src", "main.ts");
// "src/main.ts"
```

## `path.resolve(p)`

Resolve a path to an absolute path.

```typescript
const abs = path.resolve("./hello.ts");
// "/home/user/project/hello.ts"
```

## `path.dirname(p)`

Get the directory component of a path.

```typescript
const dir = path.dirname("/home/user/file.txt");
// "/home/user"
```

## `path.basename(p)`

Get the filename component of a path.

```typescript
const name = path.basename("/home/user/file.txt");
// "file.txt"
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `path.resolve()` | `realpath()` |
| `path.dirname()` | string manipulation |
| `path.basename()` | string manipulation |
| `path.join()` | string concatenation with `/` |
