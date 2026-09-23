// `x++` / `--x` whose value is used, the natural shape of a closure over a counter.
let next = 10;
const take = (): number => next++;
const peekAfter = (): number => ++next;
console.log(take(), take(), peekAfter(), next);

function ids(): () => number {
  let n = 0;
  return () => n++;
}
const id = ids();
id();
console.log(id(), id());

let down = 3;
const xs: number[] = [];
while (down > 0) xs.push(down--);
console.log(xs, down, --down);
