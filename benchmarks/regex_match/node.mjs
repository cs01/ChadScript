const N = 100000;
const re = /^[a-z]+([0-9]+)[a-z]*$/;

const strs = [];
for (let i = 0; i < N; i++) strs.push("abc" + i + "def");

const start = process.hrtime.bigint();
let hits = 0;
for (let j = 0; j < N; j++) {
  if (re.test(strs[j])) hits++;
}
const elapsed = Number(process.hrtime.bigint() - start) / 1e9;

console.log("Matches:  " + hits);
console.log("Time:     " + elapsed.toFixed(6) + "s");
