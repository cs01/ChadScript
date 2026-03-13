const n = 42;
const s = n.toString();
if (s !== "42") {
  process.exit(1);
}

const pi = 3.14159;
const ps = pi.toString();
if (ps !== "3.14159") {
  process.exit(1);
}

const neg = -100;
const ns = neg.toString();
if (ns !== "-100") {
  process.exit(1);
}

const zero = 0;
const zs = zero.toString();
if (zs !== "0") {
  process.exit(1);
}

const big = 1000000;
const bs = big.toString();
if (bs !== "1000000") {
  process.exit(1);
}

const f = Math.floor(3.7);
if (f !== 3) {
  process.exit(1);
}

const c = Math.ceil(3.2);
if (c !== 4) {
  process.exit(1);
}

const r = Math.round(3.5);
if (r !== 4) {
  process.exit(1);
}

const a = Math.abs(-42);
if (a !== 42) {
  process.exit(1);
}

const mx = Math.max(Math.max(1, 5), 3);
if (mx !== 5) {
  process.exit(1);
}

const mn = Math.min(Math.min(1, 5), 3);
if (mn !== 1) {
  process.exit(1);
}

const sq = Math.sqrt(144);
if (sq !== 12) {
  process.exit(1);
}

console.log("TEST_PASSED");
