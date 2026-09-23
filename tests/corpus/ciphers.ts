// @category: text
// Caesar and Vigenere ciphers, ROT13, and breaking a Caesar cipher by letter-frequency
// chi-squared scoring.

const ENGLISH_FREQ = [
  8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4, 6.7, 7.5, 1.9, 0.095, 6.0,
  6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074,
];

function shiftChar(ch: string, k: number): string {
  const code = ch.charCodeAt(0);
  const base = code >= 65 && code <= 90 ? 65 : code >= 97 && code <= 122 ? 97 : -1;
  if (base < 0) return ch;
  return String.fromCharCode(((((code - base + k) % 26) + 26) % 26) + base);
}

const caesar = (text: string, k: number): string => [...text].map((c) => shiftChar(c, k)).join("");
const rot13 = (text: string): string => caesar(text, 13);

function vigenere(text: string, key: string, decrypt = false): string {
  const shifts = [...key.toLowerCase()].map((c) => c.charCodeAt(0) - 97);
  let j = 0;
  return [...text]
    .map((c) => {
      if (!/[a-z]/i.test(c)) return c;
      const k = shifts[j++ % shifts.length]!;
      return shiftChar(c, decrypt ? -k : k);
    })
    .join("");
}

function chiSquared(text: string): number {
  const counts = new Array<number>(26).fill(0);
  let total = 0;
  for (const c of text.toLowerCase()) {
    const i = c.charCodeAt(0) - 97;
    if (i >= 0 && i < 26) {
      counts[i]!++;
      total++;
    }
  }
  return counts.reduce((sum, n, i) => {
    const expected = (ENGLISH_FREQ[i]! / 100) * total;
    return sum + (n - expected) ** 2 / expected;
  }, 0);
}

function crackCaesar(cipher: string): { key: number; plain: string } {
  let best = { key: 0, score: Infinity, plain: cipher };
  for (let k = 0; k < 26; k++) {
    const plain = caesar(cipher, -k);
    const score = chiSquared(plain);
    if (score < best.score) best = { key: k, score, plain };
  }
  return { key: best.key, plain: best.plain };
}

const message = "Meet me at the old bridge at midnight. Bring the documents and tell no one!";
const c3 = caesar(message, 3);
console.log(c3);
console.log(caesar(c3, -3) === message);
console.log(rot13("Hello, World!"), rot13(rot13("Hello, World!")));

const v = vigenere(message, "LEMON");
console.log(v);
console.log(vigenere(v, "LEMON", true));

const secret = caesar(
  "the quick brown fox jumps over the lazy dog while the cat sleeps in the sun",
  17,
);
const cracked = crackCaesar(secret);
console.log(`cracked key=${cracked.key}: ${cracked.plain}`);
console.log(
  `chi2 english=${chiSquared(message).toFixed(2)} gibberish=${chiSquared("zzzz qqqq xxxx").toFixed(2)}`,
);
