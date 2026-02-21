# console

Output to stdout and stderr. Maps directly to `printf()` and `fprintf(stderr, ...)`.

## `console.log(value)`

Print a value to stdout followed by a newline.

```typescript
console.log("hello");           // prints: hello
console.log(42);                // prints: 42.000000
console.log(true);              // prints: 1.000000
```

Multiple arguments are space-separated:

```typescript
console.log("count:", 42);      // prints: count: 42.000000
```

## `console.error(value)`

Print a value to stderr followed by a newline.

```typescript
console.error("something went wrong");
```

## `console.time(label)`

Start a named timer.

```typescript
console.time("build");
```

## `console.timeEnd(label)`

Stop a named timer and print elapsed time in milliseconds.

```typescript
console.time("build");
// ... do work ...
console.timeEnd("build");    // prints: build: 42.123ms
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `console.log()` | `printf()` |
| `console.error()` | `fprintf(stderr, ...)` |
| `console.time()` | `uv_hrtime()` + global StringMap |
| `console.timeEnd()` | `uv_hrtime()` delta + `printf()` |
