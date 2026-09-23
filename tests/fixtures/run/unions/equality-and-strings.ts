// === / !== on Value words (numbers numerically, strings by content), String(), templates, typeof
// as a value, and null/undefined/literal narrowing.
function eq(a: number | string | null, b: number | string | null): string {
  return `${String(a)} === ${String(b)}: ${a === b} / !==: ${a !== b}`;
}

const zero = 0;
const negZero = -0;
const nan = NaN;
console.log(eq(1, 1), eq(1, "1"), eq("ab", "a" + "b"), eq(null, null), eq(null, 0));
console.log(eq(zero, negZero), eq(nan, nan), eq("", 0), eq(2.5, 2.5));

type Token = number | string | boolean | null | undefined;
const tokens: Token[] = [3, "x", true, false, null, undefined, 0, "", NaN, -0];
for (const t of tokens) {
  const kind = typeof t;
  const s = String(t);
  let tag = "other";
  if (t === null) tag = "null";
  else if (t === undefined) tag = "undef";
  else if (t === "x") tag = "the x";
  else if (t === 3) tag = "three";
  else if (t === true) tag = "yes";
  console.log(kind, s, `[${t}]`, tag, t ? "T" : "F", !t);
}

function label(v: "a" | "b" | 1 | 2): string {
  switch (v) {
    case "a":
      return "letter a";
    case 1:
      return "one";
    case "b":
      return "letter b";
    default:
      return `number ${v}`;
  }
}
console.log(label("a"), label("b"), label(1), label(2));

function orDefault(v: string | number | undefined): string | number {
  return v ?? "default";
}
console.log(orDefault(undefined), orDefault(0), orDefault(""), orDefault("s"));

const u: string | number | undefined = Math.max(1, 2) > 1 ? "set" : undefined;
if (u !== undefined) console.log("defined", u, typeof u);
const w: number | string | null = null;
console.log(w === null, w ?? "was null");
const kinds: string[] = [];
const vals: (string | number | boolean)[] = [1, "a", false];
for (const x of vals) kinds.push(typeof x);
console.log(kinds.join(","));
let joined = "";
for (const x of vals) joined += x;
console.log("v=" + vals[0] + "|" + joined, joined + vals[1]);
