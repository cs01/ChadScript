const arr = [1, 2, 3, 4, 5];

const empty = arr.slice(5);
if (empty.length !== 0) process.exit(1);

const full = arr.slice(0);
if (full.length !== 5) process.exit(2);

const negSlice = arr.slice(-2);
if (negSlice.length !== 2) process.exit(3);
if (negSlice[0] !== 4) process.exit(4);

const midSlice = arr.slice(1, 3);
if (midSlice.length !== 2) process.exit(5);
if (midSlice[0] !== 2) process.exit(6);
if (midSlice[1] !== 3) process.exit(7);

const beyondEnd = arr.slice(0, 100);
if (beyondEnd.length !== 5) process.exit(8);

const negBoth = arr.slice(-3, -1);
if (negBoth.length !== 2) process.exit(9);

console.log("TEST_PASSED");
