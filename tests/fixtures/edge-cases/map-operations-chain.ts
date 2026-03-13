const m = new Map<string, string>();

m.set("a", "1");
m.set("b", "2");
m.set("c", "3");

if (m.size !== 3) process.exit(1);
if (m.has("a") !== true) process.exit(2);
if (m.get("a") !== "1") process.exit(3);

m.delete("b");
if (m.size !== 2) process.exit(4);
if (m.has("b") !== false) process.exit(5);

m.set("d", "4");
m.set("e", "5");
if (m.size !== 4) process.exit(6);

m.clear();
if (m.size !== 0) process.exit(7);

m.set("x", "y");
if (m.get("x") !== "y") process.exit(8);

console.log("TEST_PASSED");
