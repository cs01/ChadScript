// @expect-reject: CS1206
const o: { a?: number } = { a: 1 };
delete o.a;
console.log(o);
