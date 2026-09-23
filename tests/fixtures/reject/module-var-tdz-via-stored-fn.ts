// @expect-reject: CS1228
// The function escapes into an array and is called through it before `name` is initialized.
function greet(): string {
  return "hi " + name;
}
const fns: (() => string)[] = [greet];
const first = fns[0];
console.log(first ? first() : "none");
const name = "x";
