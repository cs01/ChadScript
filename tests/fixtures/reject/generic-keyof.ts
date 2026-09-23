// @expect-reject: CS1243
function get<T, K extends keyof T>(o: T, k: K): T[K] {
  return o[k];
}
console.log(get({ a: 1 }, "a"));
