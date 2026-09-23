// Value unions in locals, parameters and returns, printed and narrowed by typeof.
function describe(v: number | string | boolean): string {
  if (typeof v === "number") return `number ${v + 1}`;
  if (typeof v === "string") return `string of length ${v.length}`;
  return v ? "true!" : "false!";
}

function pick(i: number): number | string | undefined {
  if (i === 0) return 42;
  if (i === 1) return "forty-two";
  return undefined;
}

function twice(x: string | number): string | number {
  return typeof x === "number" ? x * 2 : x + x;
}

let a: number | string = 1;
console.log(a, typeof a);
a = "one";
console.log(a, typeof a);
for (let i = 0; i < 4; i++) {
  const p = pick(i);
  console.log(i, p, typeof p, describe(p === undefined ? false : p));
}
console.log(describe(3), describe("abc"), describe(true), describe(false));
console.log(twice(21), twice("ab"));
const mixed: (number | string)[] = [];
let v: string | number | boolean = 0;
for (let i = 0; i < 6; i++) {
  if (i % 3 === 0) v = i;
  else if (i % 3 === 1) v = `s${i}`;
  else v = i % 2 === 0;
  console.log(v, typeof v, v ? "truthy" : "falsy");
  if (typeof v !== "boolean") mixed.push(v);
}
console.log(mixed);
