// @expect-reject: CS1228
// `LIMIT` is a module-scope global assigned when main reaches its declaration — but `check` runs
// before that, so Node throws ReferenceError where a zero-initialized global would silently
// answer 0.
function check(n: number): boolean {
  return n < LIMIT;
}

console.log(check(5));

const LIMIT = 10;
