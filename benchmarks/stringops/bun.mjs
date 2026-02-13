const COUNT = 100000;

const start = performance.now();

const pieces = [];
for (let i = 0; i < COUNT; i++) {
  pieces.push(`item${i}`);
}
const big = pieces.join(",");

const parts = big.split(",");
for (let i = 0; i < parts.length; i++) {
  parts[i] = parts[i].toUpperCase();
}
const result = parts.join(",");

const elapsed = (performance.now() - start) / 1000;
console.log(`Strings:  ${COUNT}`);
console.log(`Length:   ${result.length}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
