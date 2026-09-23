// Closures capture variables by reference: a counter factory, a callback that reassigns a
// captured local, and per-iteration `let` bindings exactly as in JavaScript.
function counter(start: number): () => number {
  let n = start;
  return (): number => {
    n += 1;
    return n;
  };
}

const next = counter(10);
next();
console.log(next(), next());

let total = 0;
[1, 2, 3].forEach((x: number): void => {
  total += x;
});
console.log("total", total);

const printers: (() => string)[] = [];
for (let i = 0; i < 3; i++) {
  printers.push((): string => `i=${i}`);
}
console.log(printers.map((p: () => string): string => p()).join(" "));

function compose(f: (x: number) => number, g: (x: number) => number): (x: number) => number {
  return (x: number): number => g(f(x));
}
const incThenDouble = compose(
  (x: number): number => x + 1,
  (x: number): number => x * 2,
);
console.log(incThenDouble(5));
