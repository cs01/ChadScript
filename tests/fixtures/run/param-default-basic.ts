// Default and optional parameters on top-level and nested functions: omitted vs explicit
// `undefined` vs `null`, defaults that read earlier parameters, side-effecting defaults that run
// only when needed, and a fresh array per call.
let calls = 0;
function counted(): number {
  calls++;
  return 100;
}
function withEffect(x: number = counted()): number {
  return x;
}
console.log(withEffect(), withEffect(5), withEffect(undefined), calls);

function greet(name = "world", punct: string = "!"): string {
  return "hi " + name + punct;
}
console.log(greet(), greet("bob"), greet(undefined, "?"), greet("al", undefined));

function scale(a: number, b = a * 2, c = a + b): string {
  return `${a} ${b} ${c}`;
}
console.log(scale(1), scale(1, 5), scale(2, undefined, 0));

function nullOrDefault(x: number | null = 7): string {
  return x === null ? "null" : `n${x}`;
}
console.log(nullOrDefault(), nullOrDefault(null), nullOrDefault(undefined), nullOrDefault(3));

function push(v: number, xs: number[] = []): number[] {
  xs.push(v);
  return xs;
}
const shared = [9];
console.log(push(1), push(2), push(3, shared), push(4, shared));

function opt(x: number, y?: number): number {
  return x + (y ?? 10);
}
console.log(opt(1), opt(1, 2), opt(1, undefined));

function optStr(s?: string): string {
  if (s === undefined) return "none";
  return s.toUpperCase();
}
console.log(optStr(), optStr("abc"));

function maybe(n: number): number | undefined {
  return n > 2 ? n : undefined;
}
console.log(withEffect(maybe(1)), calls);
console.log(withEffect(maybe(4)), calls);

let base = 3;
function readsGlobal(x = base * 10): number {
  return x;
}
console.log(readsGlobal());
base = 4;
console.log(readsGlobal(), readsGlobal(1));

function outer(k: number): number {
  const inner = (a: number, b = k): number => a * b;
  return inner(2) + inner(2, 1);
}
console.log(outer(5));

function obj(o: { n: number } = { n: 1 }): number {
  o.n++;
  return o.n;
}
console.log(obj(), obj(), obj({ n: 10 }));

function union(v: number | string = "dflt"): string {
  return typeof v === "number" ? `num ${v}` : `str ${v}`;
}
console.log(union(), union(3), union("x"), union(undefined));

function optUnion(v?: number | string): string {
  return v === undefined ? "none" : `${v}`;
}
console.log(optUnion(), optUnion(1), optUnion("s"));

function many(a = 1, b = 2, c = 3, d?: number): number {
  return a + b + c + (d ?? 0);
}
console.log(many(), many(10), many(10, 20), many(10, 20, 30), many(10, 20, 30, 40));

function boolDefault(flag = true): string {
  return flag ? "yes" : "no";
}
console.log(boolDefault(), boolDefault(false));

function reassign(x = 1): number {
  x += 5;
  return x;
}
console.log(reassign(), reassign(10));

function rest(a: number, b = 2, ...more: number[]): number {
  return a + b + more.length;
}
console.log(rest(1), rest(1, 5), rest(1, 5, 7, 8));

function printsOpt(x?: number): void {
  console.log(x);
}
printsOpt();
printsOpt(3);
