// JS per-iteration bindings: closures made in different iterations of a `for (let ...)` see
// different variables, and the update runs on the NEXT iteration's copy.
const fns: (() => number)[] = [];
for (let i = 0; i < 3; i++) {
  fns.push(() => i);
}
console.log(fns.map((f) => f()).join(","));

// The closure mutates its own iteration's copy; the loop counter is unaffected by later calls.
const incs: (() => number)[] = [];
for (let i = 0; i < 3; i++) {
  incs.push(() => {
    i += 10;
    return i;
  });
}
console.log(incs.map((f) => f()).join(","), incs.map((f) => f()).join(","));

// A body mutation is visible to the update of the same iteration.
const seen: (() => number)[] = [];
for (let i = 0; i < 10; i++) {
  seen.push(() => i);
  i += 2;
}
console.log(seen.map((f) => f()).join(","));

// `continue` still renews the binding before the update.
const odd: (() => number)[] = [];
for (let i = 0; i < 6; i++) {
  if (i % 2 === 0) continue;
  odd.push(() => i);
}
console.log(odd.map((f) => f()).join(","));

// Two header variables, both per-iteration.
const pairs: (() => string)[] = [];
for (let i = 0, j = 10; i < 3; i++) {
  pairs.push(() => `${i}:${j}`);
  j--;
}
console.log(pairs.map((f) => f()).join(" "));

// A closure made in the condition sees that iteration's variable.
const conds: (() => number)[] = [];
for (let i = 0; conds.push(() => i) < 4 && i < 3; i++) {
  // empty body
}
console.log(conds.map((f) => f()).join(","));

// for...of with a `let` that the body reassigns: one binding per element.
const words: (() => string)[] = [];
for (let w of ["a", "b", "c"]) {
  words.push(() => w);
  w = w + w;
}
console.log(words.map((f) => f()).join(","));

// A `let` declared in a loop body is fresh each iteration.
const bodies: (() => number)[] = [];
let k = 0;
while (k < 3) {
  let sq = k * k;
  bodies.push(() => sq);
  sq += 1;
  k++;
}
console.log(bodies.map((f) => f()).join(","));

// A variable declared outside the loop is ONE binding shared by every closure.
const shared: (() => number)[] = [];
let s = 0;
for (let i = 0; i < 3; i++) {
  s += i;
  shared.push(() => s);
}
s = 99;
console.log(shared.map((f) => f()).join(","));
