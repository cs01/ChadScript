// @known-bug: JSON.parse lays objects out in the declared type's field order and materializes absent optional keys; Node keeps the JSON text's key order and omits absent keys
interface Rec {
  a: number;
  b: string;
  c?: boolean;
}
const r: Rec = JSON.parse('{"b":"x","a":1}');
console.log(r);
console.log(JSON.stringify(r), Object.keys(r).join(","));
