const m = new Map<number, number>();

m.set(0, 100);
m.set(1, 200);
m.set(-1, 300);

if (m.size !== 3) process.exit(1);
if (m.get(0) !== 100) process.exit(2);
if (m.get(-1) !== 300) process.exit(3);
if (m.has(1) !== true) process.exit(4);

m.delete(0);
if (m.size !== 2) process.exit(5);
if (m.has(0) !== false) process.exit(6);

m.set(5, 500);
if (m.get(5) !== 500) process.exit(7);
if (m.size !== 3) process.exit(8);

console.log("TEST_PASSED");
