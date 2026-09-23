// Function values compare by identity, as in Node: every reference to a named function is the
// same object, each evaluation of an arrow is a new one, and a stored function is itself.
function add(a: number): number {
  return a + 1;
}
function sub(a: number): number {
  return a - 1;
}
const h = add;
console.log(add === add, add === sub, h === add, h !== add, h === sub);

const fns = [add, sub];
console.log(
  fns.includes(add),
  fns.indexOf(sub),
  fns.indexOf(h),
  fns.includes((a) => a),
);

const holder = { f: add };
console.log(holder.f === add, holder.f === sub);

const makeArrow = (): ((a: number) => number) => (a: number) => a * 2;
const a1 = makeArrow();
const a2 = makeArrow();
console.log(a1 === a2, a1 === a1);

let current: (a: number) => number = add;
function pick(flag: boolean): void {
  current = flag ? add : sub;
}
pick(false);
console.log(current === sub, current === add);

const maybe: ((a: number) => number) | undefined = fns.find((f) => f === sub);
console.log(maybe === sub, maybe === add, maybe === undefined);

// Through a union Value word.
function pickU(k: boolean): ((a: number) => number) | string {
  return k ? add : "s";
}
const u = pickU(true);
console.log(u === add, u === sub, pickU(false) === "s");
