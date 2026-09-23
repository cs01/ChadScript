// @expect-reject: CS1235
// JSON.parse omits an optional key the text does not have, so writing it could add a property.
interface P {
  x: number;
  note?: string;
}
const p: P = JSON.parse('{"x":1}');
p.note = "added";
console.log(p);
