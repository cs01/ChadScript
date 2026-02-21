# Date

Date and time utilities.

## `Date.now()`

Returns the number of milliseconds since the Unix epoch (January 1, 1970 00:00:00 UTC).

```typescript
const timestamp = Date.now();
console.log(timestamp);    // e.g. 1700000000000
```

## `new Date()`

Create a Date object with the current time.

```typescript
const now = new Date();
```

## `new Date(ms)`

Create a Date object from a millisecond timestamp.

```typescript
const d = new Date(1705318245000);
```

## Instance Methods

### Time

```typescript
d.getTime()         // number — milliseconds since epoch
```

### Date Components (local time)

```typescript
d.getFullYear()     // number — 4-digit year (e.g. 2024)
d.getMonth()        // number — month (0-11, 0 = January)
d.getDate()         // number — day of month (1-31)
d.getHours()        // number — hours (0-23)
d.getMinutes()      // number — minutes (0-59)
d.getSeconds()      // number — seconds (0-59)
```

### Formatting

```typescript
d.toISOString()     // string — "2024-01-15T11:30:45Z" (UTC)
```

## Example

```typescript
const start = Date.now();

// ... do some work ...

const elapsed = Date.now() - start;
console.log("Elapsed ms:");
console.log(elapsed);

const d = new Date();
console.log(d.getFullYear());
console.log(d.toISOString());
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `Date.now()` | `gettimeofday()` |
| `new Date()` | `gettimeofday()` + store ms in `%Date` struct |
| `getFullYear()` etc. | `localtime_r()` + struct tm field access |
| `toISOString()` | `gmtime_r()` + `strftime()` |
