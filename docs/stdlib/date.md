# Date

Date and time utilities.

## `Date.now()`

Returns the number of milliseconds since the Unix epoch (January 1, 1970 00:00:00 UTC).

```typescript
const timestamp = Date.now();
console.log(timestamp);    // e.g. 1700000000000
```

## Example

```typescript
const start = Date.now();

// ... do some work ...

const elapsed = Date.now() - start;
console.log("Elapsed ms:");
console.log(elapsed);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `Date.now()` | `gettimeofday()` |
