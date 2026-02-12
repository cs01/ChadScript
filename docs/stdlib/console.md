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

## Native Implementation

| API | Maps to |
|-----|---------|
| `console.log()` | `printf()` |
| `console.error()` | `fprintf(stderr, ...)` |
