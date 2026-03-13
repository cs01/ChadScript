let result = "";
for (let i = 0; i < 1000; i++) {
  result = result + "a";
}
if (result.length !== 1000) process.exit(1);

const big = "x".repeat(10000);
if (big.length !== 10000) process.exit(1);

const idx = big.indexOf("x");
if (idx !== 0) process.exit(1);

const sub = big.substring(5000, 5010);
if (sub.length !== 10) process.exit(1);

console.log("TEST_PASSED");
