// @category: text
// Number formatting: Roman numerals both ways, English words for integers, ordinals, thousands
// separators, and human-readable byte sizes.

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000)
    throw new RangeError(`cannot express ${n} in Roman numerals`);
  let out = "";
  for (const [value, sym] of ROMAN) {
    while (n >= value) {
      out += sym;
      n -= value;
    }
  }
  return out;
}

function fromRoman(s: string): number {
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = val[s[i]!] ?? 0;
    const next = val[s[i + 1] ?? ""] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

function toWords(n: number): string {
  if (n < 0) return `minus ${toWords(-n)}`;
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${toWords(n % 100)}` : ""}`;
  for (const [scale, name] of SCALES) {
    if (n >= scale) {
      const rest = n % scale;
      return `${toWords(Math.floor(n / scale))} ${name}${rest ? (rest < 100 ? " and " : ", ") + toWords(rest) : ""}`;
    }
  }
  throw new Error("unreachable");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

function withCommas(n: number): string {
  const [int, frac] = n.toFixed(2).split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

for (const n of [1, 4, 9, 14, 40, 90, 400, 1994, 2024, 3999]) {
  const r = toRoman(n);
  console.log(`${n} = ${r} = ${fromRoman(r)}`);
}
try {
  toRoman(0);
} catch (e) {
  console.log((e as RangeError).message);
}
for (const n of [0, 7, 13, 21, 99, 100, 101, 342, 1000, 1001, 12345, 1000000, 2147483647, -45]) {
  console.log(`${n}: ${toWords(n)}`);
}
console.log([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 112].map(ordinal).join(" "));
console.log([0, 999.5, 1234567.891, 1e9].map(withCommas).join(" | "));
console.log([0, 1023, 1024, 1536, 1048576, 5e9, 3e13].map(humanBytes).join(", "));
