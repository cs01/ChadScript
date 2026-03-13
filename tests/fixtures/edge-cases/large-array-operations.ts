const arr: number[] = [];
for (let i = 0; i < 100; i++) {
  arr.push(i);
}
if (arr.length !== 100) process.exit(1);

const reversed = arr.reverse();
if (reversed[0] !== 99) process.exit(1);
if (reversed[99] !== 0) process.exit(1);

const sliced = arr.slice(90, 100);
if (sliced.length !== 10) process.exit(1);
if (sliced[0] !== 9) process.exit(1);

arr.splice(0, 50);
if (arr.length !== 50) process.exit(1);

console.log("TEST_PASSED");
