interface Rec {
  a: number;
  b: string;
  c?: boolean;
}
const r: Rec = JSON.parse('{"b":"x","a":1}');
console.log(r);
console.log(JSON.stringify(r), Object.keys(r).join(","));
