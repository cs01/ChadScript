const o: any = JSON.parse('{"foo": 1, "bar": "hello", "baz": true}');
const keys = Object.keys(o);
for (const k of keys) {
  console.log(k + "=" + String(o[k]));
}

const k1 = "foo";
console.log(o[k1]);
