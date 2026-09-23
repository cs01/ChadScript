// @expect-reject: CS1000
// `this` in a `function` expression is bound by the caller (here: the object it is called on),
// which the subset does not model.
interface Counter {
  n: number;
  get: () => number;
}
const c: Counter = {
  n: 1,
  get: function (this: Counter): number {
    return this.n;
  },
};
console.log(c.get());
