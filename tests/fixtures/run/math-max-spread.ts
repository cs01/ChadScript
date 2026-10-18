// Math.max / Math.min with array spread arguments: empty arrays, NaN, signed zeros, and spreads
// mixed with plain arguments.
const empty: number[] = [];
const xs: number[] = [3, -7, 12.5, 0, 4];
const withNaN: number[] = [1, NaN, 3];
const zeros: number[] = [-0, 0];
const negZeros: number[] = [-0, -0];
console.log(Math.max(...xs), Math.min(...xs));
console.log(Math.max(...empty), Math.min(...empty));
console.log(Math.max(...withNaN), Math.min(...withNaN));
console.log(Math.max(...zeros), Math.min(...zeros), 1 / Math.max(...zeros), 1 / Math.min(...zeros));
console.log(Math.max(...negZeros), Math.max(0, ...negZeros), Math.min(...negZeros, 0));
console.log(Math.max(0, ...xs, 5), Math.min(100, ...empty), Math.max(...xs, ...withNaN));
console.log(Math.min(...xs, -100), Math.max(-Infinity, ...empty, -5));
const scores = [88, 92, 79, 95, 61];
const best = Math.max(...scores);
const worst = Math.min(...scores);
console.log(`range ${worst}..${best} spread ${best - worst}`);
const big: number[] = [];
for (let i = 0; i < 1000; i++) big.push((i * 7919) % 1009);
console.log(Math.max(...big), Math.min(...big));
console.log(Math.max(...scores.map((s) => s / 10)));
