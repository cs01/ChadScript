const fruits = ["banana", "apple", "cherry", "date"];

const sorted = fruits.slice(0, fruits.length);
sorted.sort();
if (sorted[0] !== "apple") process.exit(1);
if (sorted[3] !== "date") process.exit(1);

const joined = fruits.join(", ");
if (joined !== "banana, apple, cherry, date") process.exit(1);

const idx = fruits.indexOf("cherry");
if (idx !== 2) process.exit(1);

const notFound = fruits.indexOf("grape");
if (notFound !== -1) process.exit(1);

const has = fruits.includes("date");
if (!has) process.exit(1);

const noHas = fruits.includes("grape");
if (noHas) process.exit(1);

const sliced = fruits.slice(1, 3);
if (sliced.length !== 2) process.exit(1);
if (sliced[0] !== "apple") process.exit(1);
if (sliced[1] !== "cherry") process.exit(1);

const reversed = fruits.slice(0, fruits.length);
reversed.reverse();
if (reversed[0] !== "date") process.exit(1);
if (reversed[3] !== "banana") process.exit(1);

console.log("TEST_PASSED");
