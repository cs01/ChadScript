const s = new Set<string>();

s.add("hello");
s.add("world");
s.add("hello");

if (s.size !== 2) process.exit(1);
if (s.has("hello") !== true) process.exit(2);
if (s.has("missing") !== false) process.exit(3);

s.delete("hello");
if (s.size !== 1) process.exit(4);
if (s.has("hello") !== false) process.exit(5);

s.add("a");
s.add("b");
s.add("c");
if (s.size !== 4) process.exit(6);

s.add("d");
if (s.size !== 5) process.exit(7);

s.delete("a");
s.delete("b");
if (s.size !== 3) process.exit(8);

console.log("TEST_PASSED");
