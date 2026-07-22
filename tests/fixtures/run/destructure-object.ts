// Object destructuring in a variable declaration: shorthand, renaming, and evaluate-once semantics.
interface Point {
  x: number;
  y: number;
  label: string;
}
function make(): Point {
  console.log("made"); // must print exactly once — the object is evaluated once
  return { x: 3, y: 4, label: "p" };
}
const { x, y, label } = make();
console.log(x, y, label);
const { x: px, label: name } = make();
console.log(px, name.toUpperCase());
function mag(p: Point): number {
  const { x, y } = p;
  return x * x + y * y;
}
console.log(mag({ x: 3, y: 4, label: "q" }));
