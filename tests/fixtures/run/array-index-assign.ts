// `arr[i] = v` element assignment. Note that `arr[i] += v` cannot typecheck at all under
// noUncheckedIndexedAccess (the read is `T | undefined`), so the compound form is unreachable —
// reads must go through `?? default`, which is what makes the write side sound.
const a = [1, 2, 3, 4];
a[0] = 10;
a[2] = (a[1] ?? 0) + 100;
console.log(a.join(","));

a[1] = (a[1] ?? 0) + 5;
console.log(a.join(","));

// Writes through nested loops — the sieve pattern.
const flags = [true, true, true, true, true, true];
for (let i = 2; i < flags.length; i++) {
  for (let j = i * 2; j < flags.length; j += i) {
    flags[j] = false;
  }
}
console.log(flags.join(","));

// Strings and a computed index.
const names = ["a", "b", "c"];
const k = 1;
names[k] = "z";
console.log(names.join(""));

// A negative index writes nothing and does not corrupt the array.
const safe = [7, 8];
safe[-1] = 99;
console.log(safe.join(","), safe.length);

// Objects as elements: the slot holds the reference, so the write replaces it.
const pts = [{ x: 1 }, { x: 2 }];
pts[0] = { x: 42 };
for (const p of pts) console.log(p.x);
