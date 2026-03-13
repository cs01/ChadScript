const empty = "";

if (empty.length !== 0) process.exit(1);
if (empty.trim() !== "") process.exit(2);
if (empty.toUpperCase() !== "") process.exit(3);
if (empty.toLowerCase() !== "") process.exit(4);
if (empty.indexOf("x") !== -1) process.exit(5);
if (empty.includes("x") !== false) process.exit(6);
if (empty.startsWith("") !== true) process.exit(7);
if (empty.endsWith("") !== true) process.exit(8);

const parts = empty.split(",");
if (parts.length !== 1) process.exit(9);
if (parts[0] !== "") process.exit(10);

const repeated = empty.repeat(100);
if (repeated !== "") process.exit(11);

const replaced = empty.replace("a", "b");
if (replaced !== "") process.exit(12);

console.log("TEST_PASSED");
