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

## `path.extname(p)`

Get the file extension (including the dot).

```typescript
const ext = path.extname("/home/user/file.txt");
// ".txt"
```

## `path.isAbsolute(p)`

Check if a path is absolute (starts with `/`).

```typescript
path.isAbsolute("/home/user");  // true
path.isAbsolute("./file.txt");  // false
```

## `path.relative(from, to)`

Compute the relative path from one path to another.

```typescript
const rel = path.relative("/home/user/src", "/home/user/lib/utils.ts");
// "../lib/utils.ts"
```

## `path.normalize(p)`

Normalize a path, resolving `.` and `..` segments and collapsing duplicate separators.

```typescript
const clean = path.normalize("/home/user/../user/./src//main.ts");
// "/home/user/src/main.ts"
```

## `path.parse(p)`

Decompose a path into its components.

```typescript
const parsed = path.parse("/home/user/file.txt");
// parsed.root = "/"
// parsed.dir  = "/home/user"
// parsed.base = "file.txt"
// parsed.name = "file"
// parsed.ext  = ".txt"
```

## Constants

```typescript
path.sep        // "/" (path separator)
path.delimiter  // ":" (PATH delimiter)
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `path.resolve()` | `realpath()` |
| `path.dirname()` | string manipulation |
| `path.basename()` | string manipulation |
| `path.join()` | string concatenation with `/` |
| `path.extname()` | `strrchr()` |
| `path.relative()` | custom LLVM IR (normalize + common prefix) |
| `path.parse()` | custom LLVM IR (`strrchr` for last slash/dot) |
| `path.normalize()` | custom LLVM IR (segment-by-segment resolution) |
