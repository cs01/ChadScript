const x: number = 3.14159;
console.log(x.toFixed(2));
console.log(x.toFixed(0));
const n: number = 42;
console.log(n.toString());
console.log((0).toString());
console.log((100.5).toFixed(1));

function double(x: number): number { return x * 2; }
function isPos(x: number): boolean { return x > 0; }
const arr = [1, 2, 3, 4];
console.log(arr.map(double).join(","));
console.log(arr.filter(isPos).length);
