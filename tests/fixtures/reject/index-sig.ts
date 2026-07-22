// @expect-reject: CS1207
interface Bag {
  [k: string]: number;
}
const b: Bag = {};
