const o: any = JSON.parse('{"a": 1, "b": "hello", "c": true}');
const ks = Object.keys(o);
for (const k of ks) {
  console.log(k);
}
console.log("count:", ks.length);

const inline: any = { x: 10, y: 20, z: 30 };
const ks2 = Object.keys(inline);
console.log("inline count:", ks2.length);
for (const k of ks2) {
  console.log(k);
}
