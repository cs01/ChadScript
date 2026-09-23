// An arrow whose body is an assignment evaluates to the assigned value, the common way to write an
// accumulating callback: `(chunk) => (text += chunk)`.
let text = "";
const append = (s: string): string => (text += s);
console.log(append("a"), append("bc"), text);

const counter = { total: 0 };
const add = (n: number): number => (counter.total += n);
console.log(add(2), add(5), counter.total);

let last = 0;
const setLast = (n: number): number => (last = n * 10);
console.log(setLast(4), last);

const parts: string[] = [];
["x", "y", "z"].forEach((p) => (text += p));
["x", "y"].forEach((p) => parts.push(p));
console.log(text, parts.join("+"));
