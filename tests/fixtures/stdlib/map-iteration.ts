const m = new Map<string, number>();
m.set("x", 10);
m.set("y", 20);
m.set("z", 30);

for (const [k, v] of m) {
  console.log(k, v);
}

const m2 = new Map<string, string>();
m2.set("hello", "world");
m2.set("foo", "bar");

for (const [key, val] of m2) {
  console.log(key + "=" + val);
}

const m3 = new Map<number, string>();
m3.set(1, "one");
m3.set(2, "two");

for (const [n, s] of m3) {
  console.log(n, s);
}
