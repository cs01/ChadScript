// @category: scripts
// FizzBuzz three ways (loop, rule table, functional), plus the classic interview follow-ups:
// sum of multiples, counting, and a custom rule set.

function fizzbuzzLoop(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else out.push(String(i));
  }
  return out;
}

interface Rule {
  divisor: number;
  word: string;
}

function fizzbuzzRules(n: number, rules: Rule[]): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    let s = "";
    for (const rule of rules) {
      if (i % rule.divisor === 0) s += rule.word;
    }
    out.push(s === "" ? i.toString() : s);
  }
  return out;
}

const fizzbuzzFunctional = (n: number): string[] =>
  [...Array(n).keys()]
    .map((i) => i + 1)
    .map((i) => (i % 3 ? "" : "Fizz") + (i % 5 ? "" : "Buzz") || `${i}`);

const a = fizzbuzzLoop(30);
const b = fizzbuzzRules(30, [
  { divisor: 3, word: "Fizz" },
  { divisor: 5, word: "Buzz" },
]);
const c = fizzbuzzFunctional(30);
console.log(a.join(" "));
console.log("all agree:", a.join() === b.join() && b.join() === c.join());

let sum = 0;
for (let i = 1; i < 1000; i++) {
  if (i % 3 === 0 || i % 5 === 0) sum += i;
}
console.log("sum of multiples of 3 or 5 below 1000:", sum);

const counts: { [word: string]: number } = {};
for (const s of fizzbuzzLoop(100)) {
  const key = /^\d+$/.test(s) ? "number" : s;
  counts[key] = (counts[key] || 0) + 1;
}
console.log(counts);

const custom = fizzbuzzRules(21, [
  { divisor: 2, word: "Fizz" },
  { divisor: 3, word: "Buzz" },
  { divisor: 7, word: "Bazz" },
]);
console.log(custom.join(", "));
