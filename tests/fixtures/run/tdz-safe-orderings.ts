// Module variables read by functions, in orderings Node runs without a ReferenceError: every call
// that reaches a read happens after the variable's declaration has run.
let seed = 7;
const table = new Map<string, number>();
const log: string[] = [];

function next(): number {
  seed = (seed * 31 + 11) % 1000;
  return seed;
}

function record(key: string): void {
  table.set(key, next());
  log.push(key + "=" + String(table.get(key)));
  if (log.length > limit) log.shift();
}

class Counter {
  n = start;
  bump(): number {
    this.n += step;
    return this.n;
  }
}

// Declared after the functions and the class that read them, but before anything calls them.
const limit = 3;
const start = 10;
const step = 5;

for (const k of ["a", "b", "c", "d"]) record(k);
console.log(log.join(" "), table.size);
const c = new Counter();
console.log(c.bump(), c.bump());

// A callback handed to setTimeout runs after all top-level code, so it may read a variable
// declared below the call.
setTimeout(() => console.log("later", late), 0);
const late = "ok";

// An arrow bound to a const is only callable once its statement has run.
const show = (): string => `${seed} ${limit}`;
console.log(show());
