interface E {
  o?: number;
}
interface D {
  a: { b: { c: { d: number } } };
  e: E;
  es: E[];
}
const d: D = JSON.parse('{"es":[{},{"o":1}],"e":{},"a":{"b":{"c":{"d":1}}}}');
console.log(d);
console.log(JSON.stringify(d), JSON.stringify(d, null, 1));
console.log(Object.keys(d.e).length, d.e.o, d.es[1]?.o);
