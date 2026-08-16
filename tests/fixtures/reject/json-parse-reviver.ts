// @expect-reject: CS1214
// The reviver parameter would need a callback invoked per node with an untyped value.
interface P {
  x: number;
}
const p: P = JSON.parse('{"x":1}', (_k: string, v: number) => v);
console.log(p.x);
