// A first argument that is only a string at run time still goes through util.format, and one
// that is not a string substitutes nothing. Every argument is evaluated before anything prints.
const formats: string[] = ["%s=%d", "%i%%", "plain", "%o|%O", "%j %s", "%f %c%s", "%d %d %d"];
interface Pt {
  x: number;
  tags: string[];
}
const p: Pt = { x: 1.5, tags: ["a"] };
const nums = [7, 8, 9, 10, 11, 12, 13];
for (const f of formats) {
  console.log(f, "12.5kg", p);
  console.log(f, nums, -0, true);
  console.log(f, "only");
  console.log(f);
}
function pick(i: number): string | number {
  return i % 2 === 0 ? "%s<%d>" : i;
}
for (let i = 0; i < 4; i++) console.log(pick(i), "x", i);
const maybe: string | undefined = formats.length > 100 ? undefined : "%s!";
console.log(maybe, [1, 2]);
const none: string | undefined = formats.length > 100 ? "%s" : undefined;
console.log(none, "a%s");
function noisy(v: number): number {
  console.log("evaluating", v);
  return v;
}
console.log("%d and %d", noisy(1), noisy(2), [noisy(3)]);
console.log("plain", noisy(4));
const nested = { a: { b: { c: { d: { e: 1 } } } }, list: [[1, [2, [3, [4, [5]]]]]] };
console.log(formats[3] ?? "", nested, nested);
console.log(formats[0] ?? "", new Map<string, number[]>(), new Set<number>());
