# Async

ChadScript supports `async`/`await`, `Promise.all`, `Promise.race`, `setTimeout`, and `setInterval` via libuv.

## async / await

```typescript
async function fetchData(): any {
  const response = await fetch("https://api.example.com/data");
  return response.text();
}
```

The event loop is powered by libuv. `await` suspends the current function until the promise resolves.

## Promise.all

Run multiple async operations concurrently and wait for all to complete.

```typescript
async function main(): any {
  const results = await Promise.all([
    fetch("https://api.example.com/a"),
    fetch("https://api.example.com/b"),
    fetch("https://api.example.com/c")
  ]);
}
```

## Promise.race

Wait for the first async operation to complete.

```typescript
async function main(): any {
  const first = await Promise.race([
    fetch("https://fast.example.com"),
    fetch("https://slow.example.com")
  ]);
}
```

## setTimeout

Execute a callback after a delay (in milliseconds).

```typescript
setTimeout(() => {
  console.log("delayed");
}, 1000);
```

## setInterval

Execute a callback repeatedly at a fixed interval.

```typescript
setInterval(() => {
  console.log("tick");
}, 500);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `async`/`await` | libuv event loop + coroutine state machine |
| `Promise.all` | libuv multi-handle coordination |
| `setTimeout` | `uv_timer_start()` |
| `setInterval` | `uv_timer_start()` with repeat |
| `fetch` | libcurl on libuv thread pool |
