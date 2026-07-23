// `Date.now()` — epoch milliseconds. The VALUE cannot be diffed against the oracle (the two
// processes run at different instants), so the fixture asserts the properties that must hold:
// it is a whole number of milliseconds, it is past a date already in the past, and it is
// monotonic across two reads within one program.

const t0: number = Date.now();
console.log(t0 > 1700000000000);
console.log(Number.isInteger(t0));
console.log(t0 < 4102444800000); // year 2100 — a compiled binary reading garbage would fail this

let spin: number = 0;
for (let i = 0; i < 200000; i++) spin += i;
const t1: number = Date.now();
console.log(t1 >= t0);
console.log(spin > 0);
