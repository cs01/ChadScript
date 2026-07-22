const a = [1, 2, 3];
const b = [4, 5];
const c = a.concat(b);
console.log(c.join(","));
console.log(a.join(","));
console.log(b.join(","));
const empty: number[] = [];
console.log(a.concat(empty).join(","));
