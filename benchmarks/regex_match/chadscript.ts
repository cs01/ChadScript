const N = 100000;
const re = /^[a-z]+([0-9]+)[a-z]*$/;

const strs: string[] = [];
let i = 0;
while (i < N) {
  strs.push("abc" + i + "def");
  i = i + 1;
}

const start = Date.now();
let hits = 0;
let j = 0;
while (j < N) {
  if (re.test(strs[j])) hits = hits + 1;
  j = j + 1;
}
const elapsed = (Date.now() - start) / 1000;

console.log("Matches:  " + hits);
console.log("Time:     " + elapsed + "s");
