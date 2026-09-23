# async / await

`async` functions, `await`, `Promise.resolve`, `Promise.all`, `new Promise`, `setTimeout` /
`clearTimeout`, and `node:fs/promises` run with Node's ordering: synchronous code first, then
microtasks (every `await` yields one, even on a settled promise), then timers in deadline order.
A rejected promise makes `await` throw, so `try`/`catch` works across `await`.

<<< @/examples/async.ts

<<< @/examples/async.out{text}

## `new Promise`

`new Promise` works when the executor is written inline, with `resolve` (and `reject`, if you
use it) annotated with its function type and the executor returning `void`:

```ts
new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void): void => {
  // ...
});
```

`reject` may be left out. A typical use wraps a callback API such as `setTimeout`:

<<< @/examples/promise-executor.ts

<<< @/examples/promise-executor.out{text}

## How it runs

Each async call runs on its own stack (a fiber, `ucontext` underneath). `await` on a pending
promise switches back to the event loop, and settling the promise queues the waiting fiber as a
microtask. No state-machine transform is applied to your function, so an async body compiles like
any other function. The loop drains microtasks, then timers and I/O, until nothing is pending.

An unhandled rejection ends the program with Node's exit code.

## Limits today

- `new Promise` with an executor that is not written inline, or whose `resolve` has no type
  annotation, is rejected ([CS1000](/reference/errors#cs1000)); the message shows the form to
  write.
- `.then()` on a promise is rejected ([CS1225](/reference/errors#cs1225)); use `await`.
- `Promise<null>` is rejected ([CS1233](/reference/errors#cs1233)); use `Promise<void>` or
  `Promise<string | null>`.
- `Promise.reject`, `Promise.race` and `Promise.allSettled` are rejected
  ([CS1220](/reference/errors#cs1220)); throw inside an async function instead of
  `Promise.reject`.
- `await` at the top level of a module is rejected ([CS1000](/reference/errors#cs1000)); put the
  code in `async function main()` and call it.
- `setTimeout(async () => ...)` is rejected ([CS1231](/reference/errors#cs1231)); a rejection
  inside it would have nothing to await it.

Next: [Errors](/guide/errors).
