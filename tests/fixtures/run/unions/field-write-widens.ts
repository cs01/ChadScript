// A write through a wider static type stores a word of another kind into a field the literal was
// built with; printing and JSON must decode the word, not the literal's original field type.
const o: { x: number | undefined } = { x: 1 };
o.x = undefined;
console.log(o, JSON.stringify(o));

const narrow = { n: 1, label: "a" };
const wide: { n: number | string; label: string | boolean } = narrow;
wide.n = "one";
wide.label = true;
console.log(narrow, wide, JSON.stringify(narrow));

class Cell {
  v = 0;
}
const c = new Cell();
const view: { v: number | null } = c;
view.v = null;
console.log(c, JSON.stringify(c));
