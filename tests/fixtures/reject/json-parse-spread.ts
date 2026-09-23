// @expect-reject: CS1236
// A JSON.parse object's key order comes from the text at run time, so a spread cannot enumerate it.
interface P {
  x: number;
  y: number;
}
const p: P = JSON.parse('{"y":1,"x":2}');
const q = { ...p, z: 3 };
console.log(q);
