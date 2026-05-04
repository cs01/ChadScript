const o: any = { foo: 1, bar: 2, baz: 3 };
for (const k in o) {
  console.log(k);
}

const parsed: any = JSON.parse('{"x": 10, "y": 20}');
for (const k in parsed) {
  console.log("key=" + k);
}

let count = 0;
for (const k in o) {
  count++;
}
console.log("count=" + String(count));
