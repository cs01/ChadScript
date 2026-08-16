// @expect-reject: CS1231
// TypeScript accepts this — `() => Promise<void>` is assignable to `() => void` — so the type
// system cannot be the gate. Nothing would await the callback's promise.
setTimeout(async () => {
  console.log("never");
}, 1);
