const xs = [3, 1, 4, 1, 5, 9, 2, 6];
xs.sort((a, b) => a - b);
for (const x of xs) console.log(x);

const ys = [1, 2, 3, 4, 5];
const doubled = ys.map((x) => x * 2);
for (const d of doubled) console.log(d);

const evens = ys.filter((x) => x % 2 === 0);
for (const e of evens) console.log(e);

const sum = ys.reduce((acc, x) => acc + x, 0);
console.log("sum=" + String(sum));
