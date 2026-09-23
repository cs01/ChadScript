// @category: text
// Common string exercises: palindromes, anagram groups, vowel counts, longest word, character
// histograms, reversing words, and run-length compression.

function isPalindrome(s: string): boolean {
  const cleaned = s
    .toLowerCase()
    .split("")
    .filter((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9"))
    .join("");
  let i = 0;
  let j = cleaned.length - 1;
  while (i < j) {
    if (cleaned[i] !== cleaned[j]) return false;
    i++;
    j--;
  }
  return true;
}

function anagramGroups(words: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const w of words) {
    const key = w.toLowerCase().split("").sort().join("");
    const g = groups.get(key);
    if (g) g.push(w);
    else groups.set(key, [w]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function countVowels(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if ("aeiouAEIOU".indexOf(s.charAt(i)) !== -1) n++;
  }
  return n;
}

function longestWord(s: string): string {
  let best = "";
  for (const w of s.split(" ")) {
    const clean = w.replace(",", "").replace(".", "");
    if (clean.length > best.length) best = clean;
  }
  return best;
}

function histogram(s: string): string {
  const counts = new Map<string, number>();
  for (const c of s.toLowerCase()) {
    if (c === " ") continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
}

function reverseWords(s: string): string {
  return s.split(" ").reverse().join(" ");
}

function rle(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? String(j - i) : "") + s[i];
    i = j;
  }
  return out;
}

const phrases = [
  "A man, a plan, a canal: Panama",
  "racecar",
  "hello",
  "Was it a car or a cat I saw?",
  "No 'x' in Nixon",
  "",
];
for (const p of phrases)
  console.log(`${JSON.stringify(p)} palindrome=${isPalindrome(p)} vowels=${countVowels(p)}`);
console.log(
  anagramGroups(["listen", "silent", "enlist", "google", "gooegl", "cat", "act", "dog", "Tinsel"]),
);
const sentence = "The quick brown fox jumps over the extraordinarily lazy dog.";
console.log(longestWord(sentence), "|", reverseWords(sentence), "|", histogram(sentence));
console.log(["aaabccdddd", "abc", "", "zzzzzzzzzzzz"].map(rle));
