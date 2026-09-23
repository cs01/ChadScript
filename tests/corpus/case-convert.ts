// @category: text
// Identifier case conversions (camel, pascal, snake, kebab, constant, title), truncation with an
// ellipsis, pluralization rules, and a small slug generator.

function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

const converters: Record<string, (s: string) => string> = {
  camel: (s) =>
    words(s)
      .map((w, i) => (i === 0 ? w : capitalize(w)))
      .join(""),
  pascal: (s) => words(s).map(capitalize).join(""),
  snake: (s) => words(s).join("_"),
  kebab: (s) => words(s).join("-"),
  constant: (s) => words(s).join("_").toUpperCase(),
  title: (s) => {
    const small = new Set(["a", "an", "the", "of", "in", "on", "and", "or", "to"]);
    return words(s)
      .map((w, i, all) => (i > 0 && i < all.length - 1 && small.has(w) ? w : capitalize(w)))
      .join(" ");
  },
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut) + "…";
}

function pluralize(word: string, n: number): string {
  if (n === 1) return `${n} ${word}`;
  const irregular: Record<string, string> = { person: "people", child: "children", mouse: "mice" };
  let plural = irregular[word];
  if (plural === undefined) {
    if (/(s|x|z|ch|sh)$/.test(word)) plural = word + "es";
    else if (/[^aeiou]y$/.test(word)) plural = word.slice(0, -1) + "ies";
    else plural = word + "s";
  }
  return `${n} ${plural}`;
}

const inputs = [
  "helloWorld",
  "XMLHttpRequest",
  "user_id",
  "the lord of the rings",
  "  --Mixed_case-Input 42 ",
  "getHTTPResponseCode",
];
for (const input of inputs) {
  const cells = Object.entries(converters).map(([name, f]) => `${name}=${f(input)}`);
  console.log(`${JSON.stringify(input)}\n  ${cells.join("\n  ")}`);
}
const long = "The quick brown fox jumps over the lazy dog near the riverbank";
for (const n of [10, 20, 30, 100]) console.log(`${n}: ${truncate(long, n)}`);
for (const w of ["box", "city", "day", "person", "church", "file", "mouse"]) {
  console.log([0, 1, 3].map((n) => pluralize(w, n)).join(", "));
}
