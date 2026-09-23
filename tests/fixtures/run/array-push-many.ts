// `push` with several arguments appends all of them, evaluated before any is appended; it returns
// the new length (also for `push()` with none).
const xs: number[] = [1];
console.log(xs.push(2, 3, 4), xs);
console.log(xs.push(xs.length, xs.length), xs);
console.log(xs.push(), xs.length);
const words: string[] = [];
words.push("a", "b");
words.push("c");
console.log(words.join("-"));
interface P {
  x: number;
}
const ps: P[] = [];
ps.push({ x: 1 }, { x: 2 });
console.log(ps);
const mixed: (number | string)[] = [];
mixed.push(1, "two", 3);
console.log(mixed);
