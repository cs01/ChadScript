// A layout with an optional-element array field still gets a JSON function (every shape does);
// it used to ICE at compile time even though nothing serializes it.
class Samples {
  xs: (number | undefined)[];
  constructor(xs: (number | undefined)[]) {
    this.xs = xs;
  }
}
const s = new Samples([1, undefined, 3]);
console.log(s);
console.log({ ys: s.xs });
