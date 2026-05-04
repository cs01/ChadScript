const o1 = { a: 1, b: 2 };
const o2 = { ...o1, c: 3 };
console.log(o2.a);
console.log(o2.b);
console.log(o2.c);
console.log(o2.a + o2.b + o2.c);

const o3 = { x: 10, y: 20 };
const o4 = { ...o3, x: 99 };
console.log(o4.x);
console.log(o4.y);
