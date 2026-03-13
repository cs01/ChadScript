const s = new Set<string>();
s.add("hello");
s.add("world");
s.add("hello");

if (s.size !== 2) process.exit(1);
if (!s.has("hello")) process.exit(1);
if (!s.has("world")) process.exit(1);
if (s.has("foo")) process.exit(1);

s.delete("hello");
if (s.has("hello")) process.exit(1);
if (s.size !== 1) process.exit(1);

const ns = new Set<number>();
ns.add(1);
ns.add(2);
ns.add(3);
ns.add(2);
if (ns.size !== 3) process.exit(1);

console.log("TEST_PASSED");
