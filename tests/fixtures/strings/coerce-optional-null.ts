// String coercion (concat / template) of optional and null/undefined values. JS spells absent
// as "undefined"/"null"; present values coerce by their inner type.
const s: string = "hi";
console.log("char=" + s.at(0)); // char=h — present string optional
console.log("oob=" + s.at(9)); // oob=undefined — absent
console.log(`at1=${s.at(1)}`); // at1=i — template with present optional

const n: number | null = null;
console.log("n=" + n); // n=null
const u: string | undefined = undefined;
console.log("u=" + u); // u=undefined
console.log(`both: ${n} and ${u}`); // both: null and undefined

const nums: number[] = [7, 8, 9];
console.log("found=" + nums.find((x) => x > 7)); // found=8 — present number optional
console.log("none=" + nums.find((x) => x > 99)); // none=undefined
