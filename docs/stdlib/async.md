# Async

ChadScript supports `async`/`await`, Promises, `setTimeout`, and `setInterval` via libuv.

## async / await

```typescript
async function fetchData(): any {
  const response = await fetch("https://api.example.com/data");
  return response.text();
}
```

The event loop is powered by libuv. `await` suspends the current function until the promise resolves.

## Promise.all

Run multiple async operations concurrently and wait for all to complete. Rejects on first rejection.

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

Wait for the first async operation to settle (fulfill or reject).

```typescript
async function main(): any {
  const first = await Promise.race([
    fetch("https://fast.example.com"),
    fetch("https://slow.example.com")
  ]);
}
```

## Promise.allSettled

Wait for all promises to settle. Never short-circuits — the result array contains every outcome.

```typescript
async function main(): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve("ok"),
    Promise.reject("fail"),
    Promise.resolve("also ok")
  ]);
  console.log(results.length);    // 3
}
```

## Promise.any

Resolve with the first fulfilled promise. Rejects only if all reject.

```typescript
async function main(): Promise<void> {
  const winner: string = await Promise.any([
    Promise.reject("fail"),
    Promise.resolve("winner"),
    Promise.resolve("also")
  ]);
  console.log(winner);    // "winner"
}
```

## Promise.resolve / Promise.reject

Create immediately settled promises.

```typescript
const p = Promise.resolve("value");
const err = Promise.reject("reason");
```

## promise.then / promise.catch / promise.finally

```typescript
promise.then((value: string) => { ... });
promise.catch((err: string) => { ... });
promise.finally(() => {
  // runs regardless of outcome, propagates original value
});
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
| `Promise.all` | shared state with counter + per-index callbacks |
| `Promise.allSettled` | same pattern, never short-circuits |
| `Promise.any` | first-fulfillment wins, counter for all-rejected |
| `promise.finally` | wrapper callbacks that propagate original outcome |
| `setTimeout` | `uv_timer_start()` |
| `setInterval` | `uv_timer_start()` with repeat |
| `fetch` | libcurl on libuv thread pool |
