// `%j` of a cyclic value prints [Circular] (util.format catches the JSON cycle error), and the
// rest of the line still formats.
interface L {
  n: number;
  next: L | null;
}
const a: L = { n: 1, next: null };
console.log("%j then %j", a, 5);
a.next = a;
console.log("%j then %j", a, 5);
const xs: L[] = [a];
console.log("list %j", xs);
console.log("after");
