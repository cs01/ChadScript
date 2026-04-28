const epoch: Date = new Date(0);
console.log(epoch.getTime());
console.log(epoch.toISOString());

const d: Date = new Date(1700000000000);
console.log(d.getTime());
console.log(d.toISOString());
console.log(d.getFullYear());

const now: number = Date.now();
console.log(now > 0);

console.log(Number.isInteger(42));
console.log(Number.isInteger(3.14));
console.log(Number.isNaN(NaN));
console.log(Number.isNaN(42));
console.log(isNaN(NaN));
console.log(isNaN(42));
