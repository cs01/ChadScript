// JSON.parse keeps keys the target type does not declare, as Node does: the program cannot read them
// by name (tsc forbids it), but they are real properties, so console.log, JSON.stringify and
// Object.keys show them, in JSON text order, with nested objects and arrays of any JSON value.
interface Cfg {
  name: string;
  port: number;
  inner: { on: boolean };
}
const text =
  '{"extra":1,"name":"svc","meta":{"tags":["a",3],"deep":{"x":null}},' +
  '"port":80,"inner":{"on":false,"why":"b"},"list":[1,[2,[3]],{"k":"v"}],"n":null}';
const c: Cfg = JSON.parse(text);
console.log(c.name, c.port, c.inner.on);
console.log(c.inner);
console.log(JSON.stringify(c));
console.log(JSON.stringify(c.inner, null, 2));
console.log(Object.keys(c).join(","), Object.keys(c.inner).join(","));
const again: Cfg = JSON.parse('{"port":1,"name":"b","inner":{"on":true},"extra":"s"}');
console.log(again, JSON.stringify(again));
const deep: Cfg = JSON.parse('{"name":"d","port":2,"inner":{"on":true},"t":[1,[2,[3]]]}');
console.log(deep);
const many: Cfg[] = JSON.parse(
  '[{"name":"x","port":1,"inner":{"on":true},"z":[]},{"z":{},"name":"y","port":2,"inner":{"on":false}}]',
);
console.log(JSON.stringify(many));
for (const m of many) console.log(m);
