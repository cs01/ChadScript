// @expect-reject: CS1214
// A union of an object type and a plain kind keeps no object layout for the parser to fill.
interface Leaf {
  v: number;
}
const x: { node: Leaf | string } = JSON.parse('{"node":{"v":1}}');
console.log(x);
